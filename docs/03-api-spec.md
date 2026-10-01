# 03 — Spesifikasi API

Base URL: `http://127.0.0.1:3000`. Semua JSON. Error format: `{ "error": "pesan" }` + status code sesuai.

## Ringkasan Endpoint
| Method | Path | Deskripsi |
|---|---|---|
| GET | /api/health | status server + koneksi exchange |
| GET | /api/dashboard | agregat dashboard (portfolio, kartu exchange, win rate) |
| POST | /api/exchanges/:id/sync | sinkron saldo manual |
| POST | /api/exchanges/:id/test | test koneksi (+proxy) |
| PUT | /api/exchanges/:id | update api_key/secret/proxy/mode |
| GET | /api/pairs?exchange= | daftar pasangan default (+live) |
| GET | /api/bots | list bots (+filter status) |
| POST | /api/bots | buat bot |
| GET | /api/bots/:id | detail bot + state |
| POST | /api/bots/:id/pause | pause |
| POST | /api/bots/:id/resume | resume |
| DELETE | /api/bots/:id | hapus |
| GET | /api/bots/:id/trend | data mini-chart profit |
| POST | /api/trade/quick | quick trade {exchange,pair,side,amount,mode} |
| GET | /api/trades?... | riwayat trades (filter) |
| GET | /api/logs?level=&tag=&limit= | log operasional |
| DELETE | /api/logs | bersihkan log |
| GET | /api/wizard/presets?pair= | skor preset + rekomendasi |
| POST | /api/wizard/backtest | jalankan backtest {pair,strategy,params,days} |
| GET | /api/settings | semua settings (secret masked) |
| PUT | /api/settings | update settings |
| POST | /api/telegram/test | kirim pesan tes |

## Payload Penting

### GET /api/dashboard → 200
```json
{
  "portfolio": { "total_idr": 5447565, "change_24h_pct": 0.15, "change_24h_idr": 8140 },
  "realized": { "total_idr": 55706, "win_rate": 0.097, "wins": 11, "total": 113, "floating_24h_idr": 8349 },
  "exchanges": [
    {
      "id": "indodax", "name": "Indodax", "mode": "live", "status": "ok",
      "saldo_idr": 806, "profit_harian": 5, "profit_total": 5,
      "kas_bebas": 0, "pending_value": 0, "posisi_pct": 0,
      "coins": [ {"symbol":"BTC","qty":0.000001,"value_idr":806,"porsi_pct":100} ],
      "pending_orders": []
    }
  ]
}
```

### POST /api/bots
```json
{
  "name":"Grid XRP #1","exchange_id":"indodax","pair":"XRPIDR","strategy":"grid",
  "params":{"lower_pct":-3,"upper_pct":3,"levels":6},
  "budget_idr":100000,"auto_compound_pct":100,"mode":"paper"
}
```
→ 201 `{ id, ...bot }`

### POST /api/trade/quick
```json
{ "exchange_id":"tokocrypto","pair":"XRPUSDT","side":"buy","amount":10,"mode":"paper" }
```
→ 200 `{ order_id, price, qty, fee }`

## WebSocket (`/socket.io`)
Events dari server:
| Event | Payload |
|---|---|
| `log` | baris log baru `{id,level,tag,message,impact_rp,created_at,bot_id}` |
| `bot` | update bot `{id,status,current_budget,stats}` |
| `trade` | trade baru (untuk toast + refresh riwayat) |
| `dashboard` | refresh ringkasan (throttled 10s) |

Client emit: `subscribe` (tanpa payload) — opsional, default semua client dapat semua event (single user).
