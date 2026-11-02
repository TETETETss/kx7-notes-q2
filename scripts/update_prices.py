#!/usr/bin/env python3
"""Fetch public prices and write data/prices.json. No secrets, no login."""

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKETS = ROOT / "data" / "markets.json"
RESEARCH = ROOT / "data" / "research.json"
OUT = ROOT / "data" / "prices.json"
UA = "NotesDashboard/1.0"
KALSHI = "https://api.elections.kalshi.com/trade-api/v2/markets"
GAMMA = "https://gamma-api.polymarket.com/events"
WITA = timezone(timedelta(hours=8))


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as res:
        return json.loads(res.read().decode())


def cents(dollars):
    if dollars is None or dollars == "":
        return None
    return int(round(float(dollars) * 100))


def load_events():
    events = []
    markets = json.loads(MARKETS.read_text())
    events.extend(markets["events"])
    if RESEARCH.exists():
        research = json.loads(RESEARCH.read_text())
        events.extend(research.get("closedMarkets") or [])
    return events


def kalshi_event(event_ticker):
    rows = []
    cursor = ""
    while True:
        qs = urllib.parse.urlencode({
            "event_ticker": event_ticker,
            "limit": 200,
            "cursor": cursor,
        })
        data = get_json(KALSHI + "?" + qs)
        rows.extend(data.get("markets") or [])
        cursor = data.get("cursor") or ""
        if not cursor:
            break
    return rows


def kalshi_quote(market):
    status = (market.get("status") or "").lower()
    result = (market.get("result") or "").lower()
    expiry = (market.get("expiration_value") or "").strip().lower()
    settled = None
    if result in ("yes", "no"):
        settled = "YES" if result == "yes" else "NO"
    elif status in ("finalized", "settled", "determined") and expiry in ("yes", "no"):
        settled = "YES" if expiry == "yes" else "NO"
    word = ""
    custom = market.get("custom_strike") or {}
    if isinstance(custom, dict):
        word = custom.get("Word") or ""
    word = word or market.get("yes_sub_title") or ""
    if settled:
        return word, {"settled": settled, "status": status or "finalized"}
    ask = cents(market.get("yes_ask_dollars"))
    bid = cents(market.get("yes_bid_dollars"))
    quote = {"status": status or "active"}
    if ask is not None:
        quote["yesAsk"] = ask
    if bid is not None:
        quote["yesBid"] = bid
    return word, quote


def poly_markets(slug):
    data = get_json(GAMMA + "?slug=" + urllib.parse.quote(slug))
    if isinstance(data, list):
        if not data:
            return []
        return data[0].get("markets") or []
    return (data or {}).get("markets") or []


def as_float(value):
    if value is None or value == "":
        return None
    return float(value)


def poly_quote(market):
    title = market.get("groupItemTitle") or ""
    prices = market.get("outcomePrices")
    if isinstance(prices, str):
        try:
            prices = json.loads(prices)
        except json.JSONDecodeError:
            prices = None
    yes_price = as_float(prices[0]) if isinstance(prices, list) and prices else None
    closed = bool(market.get("closed"))
    uma = (market.get("umaResolutionStatus") or "").lower()
    resolved = uma == "resolved" or (closed and yes_price is not None and (yes_price >= 0.99 or yes_price <= 0.01))
    if resolved and yes_price is not None:
        settled = "YES" if yes_price >= 0.5 else "NO"
        return title, {"settled": settled, "status": "resolved" if uma == "resolved" else "closed"}
    ask = market.get("bestAsk")
    bid = market.get("bestBid")
    quote = {"status": "closed" if closed else "active"}
    if ask is not None:
        quote["yesAsk"] = int(round(float(ask) * 100))
    if bid is not None:
        quote["yesBid"] = int(round(float(bid) * 100))
    return title, quote


def match_quotes(names, pairs):
    by_exact = {}
    by_fold = {}
    for name, quote in pairs:
        if not name:
            continue
        by_exact.setdefault(name, quote)
        by_fold.setdefault(name.casefold(), quote)
    found = {}
    used = set()
    missing = []
    for name in names:
        quote = by_exact.get(name)
        if quote is None:
            quote = by_fold.get(name.casefold())
        if quote is None:
            missing.append(name)
            continue
        found[name] = quote
        used.add(id(quote))
    unmatched = []
    for name, quote in pairs:
        if name and id(quote) not in used and name not in found:
            unmatched.append(name)
    return found, missing, unmatched


def fetch_event(event):
    names = [s["name"] for s in event.get("strikes") or []]
    if event.get("eventTicker"):
        pairs = [kalshi_quote(m) for m in kalshi_event(event["eventTicker"])]
    elif event.get("polymarketSlug"):
        pairs = [poly_quote(m) for m in poly_markets(event["polymarketSlug"])]
    else:
        raise RuntimeError("no ticker or slug")
    found, missing, unmatched = match_quotes(names, pairs)
    payload = {"strikes": found}
    if missing:
        payload["missing"] = missing
    if unmatched:
        payload["unmatched"] = unmatched[:40]
    return payload


def main():
    events = load_events()
    previous = {}
    if OUT.exists():
        try:
            previous = json.loads(OUT.read_text()).get("events") or {}
        except json.JSONDecodeError:
            previous = {}
    now = datetime.now(WITA)
    out_events = {}
    errors = []
    ok = 0
    for event in events:
        eid = event.get("id")
        if not eid:
            continue
        if not event.get("eventTicker") and not event.get("polymarketSlug"):
            continue
        try:
            out_events[eid] = fetch_event(event)
            ok += 1
        except (urllib.error.URLError, TimeoutError, RuntimeError, ValueError, KeyError) as exc:
            errors.append({"id": eid, "error": str(exc)})
            if eid in previous:
                out_events[eid] = previous[eid]
    if ok == 0:
        print("No prices fetched", file=sys.stderr)
        for err in errors:
            print(err["id"], err["error"], file=sys.stderr)
        return 1
    payload = {
        "updated": now.isoformat(timespec="seconds"),
        "updatedLabel": now.strftime("%H:%M") + " WITA",
        "events": out_events,
        "errors": errors,
    }
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {OUT.name} at {payload['updatedLabel']} ({ok} events, {len(errors)} errors)")
    for err in errors:
        print(" error", err["id"], err["error"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
