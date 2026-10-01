# 09 — Pasangan Koin Default

Hasil riset `GET https://indodax.com/api/summaries` (463 pasangan IDR; diambil saat planning). Dipilih berdasarkan volume 24 jam, likuiditas, dan kecocokan per strategi. USDT/USDC dikecualikan dari daftar bot (stabil).

## Indodax (quote IDR)
| symbol | base | label | kategori | min_lot (IDR) |
|---|---|---|---|---|
| BTCIDR | BTC | Bitcoin | Blue-chip | 50000 |
| ETHIDR | ETH | Ethereum | Blue-chip | 25000 |
| XRPIDR | XRP | XRP | Mid-cap likuid | 10000 |
| SOLIDR | SOL | Solana | Mid-cap likuid | 10000 |
| DOGEIDR | DOGE | Dogecoin | Meme likuid | 10000 |
| ADAIDR | ADA | Cardano | Mid-cap | 10000 |
| SUIIDR | SUI | Sui | Layer-1 | 10000 |
| ONDOIDR | ONDO | Ondo | RWA | 10000 |
| LINKIDR | LINK | Chainlink | Blue-chip | 25000 |
| TRXIDR | TRX | Tron | Mid-cap | 10000 |

## Tokocrypto (quote USDT)
| symbol | base | label | kategori | min_lot (USDT) |
|---|---|---|---|---|
| BTCUSDT | BTC | Bitcoin | Blue-chip | 5 |
| ETHUSDT | ETH | Ethereum | Blue-chip | 5 |
| XRPUSDT | XRP | XRP | Mid-cap likuid | 2 |
| SOLUSDT | SOL | Solana | Mid-cap likuid | 2 |
| DOGEUSDT | DOGE | Dogecoin | Meme likuid | 2 |
| ADAUSDT | ADA | Cardano | Mid-cap | 2 |
| SUIUSDT | SUI | Sui | Layer-1 | 2 |
| LINKUSDT | LINK | Chainlink | Blue-chip | 2 |
| BNBUSDT | BNB | BNB | Blue-chip | 2 |
| AVAXUSDT | AVAX | Avalanche | Mid-cap | 2 |

Catatan implementasi: `min_lot` adalah estimasi aman; nilai riil divalidasi ulang dari response error exchange bila order ditolak (disimpan ke settings `minlot_<exchange>_<pair>`).
