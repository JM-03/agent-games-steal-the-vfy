# Catatan Circuit vfy-policy — apa yang diketahui (semua terpecahkan)

## Sumber

- `https://agentgames.zkverify.io/api/circuit-info` (diambil 2026-11-13, salinan di `circuits/circuit-info.json`)
- `https://agentgames.zkverify.io/build` (dibaca 2026-11-13 12:27 UTC)
- `https://agentgames.zkverify.io/events/steal-the-vfy` (dibaca 2026-11-13 12:30 UTC)
- `~/workspace/wildcard-research/WILDCARD-RESEARCH-REPORT.md` §3.1
  (riset 14 Nov 2026 atas tiga repo peserta independen yang saling cocok)
- Probing langsung ke circuit resmi dengan `/tmp/steal-probe.cjs`
  (14 Nov 2026)

## Fakta yang terverifikasi

| Item | Nilai |
|---|---|
| Circuit | `vfy-policy`, Groth16 / BN128, Circom 2.x |
| vk_hash (mainnet) | `0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047` |
| WASM | `https://agentgames.zkverify.io/circuits/vfy-policy.wasm` (2,9 MB, sha256 `bc0998250d2baf75b89deef5306867ffa7085a08d4f7d2caf0dd63a060b134d2`) |
| zkey | `https://agentgames.zkverify.io/circuits/vfy-policy_final.zkey` (792 KB, sha256 `f9666a1655279ef27f7fee6d535ac8aa9e39286ac40ff6279fea87c21ab6ce41`) |
| Jumlah input circuit | **17** (9 skalar + array `strategyParams[0..7]` + salt) |
| Public signals (nPublic) | **9** (dari verification key yang diekspor snarkjs) |
| circuitVersion contoh resmi | `"v1"` |

## 17 input circuit — SEMUA TERBUKTI (bukan tebakan)

9 skalar (sudah terbukti sejak 13 Nov 2026 lewat probing nama):

```
commitment, matchId, selfBalance, opponentBalance, action, amount,
circuitVersion, turnNumber, salt
```

8 sisanya ternyata **satu array input `strategyParams[0..7]`**
(bukan 8 nama terpisah). Dibuktikan 14 Nov 2026: `fullProve` dengan
input array ini berhasil, 9 public signals, dan `groth16.verify`
terhadap verification key resmi = **true** (waktu fullProve 1.178 dtk).

Layout `publicSignals` (terkonfirmasi dari probing):
`[digest, commitment, matchId, turn, selfBalance, opponentBalance,
action, amount, circuitVersion]`.

## Semantik strategyParams (spesifikasi)

- `commitment = Poseidon(strategyParams[0..7], salt)` — params dulu,
  salt terakhir. (Poseidon via circomlibjs, `src/poseidon.ts`.)
- `[0]` = jumlah EXTRACT, valid **1..10**.
- `[1]` = threshold FORTIFY: FORTIFY saat `selfBalance < [1]`.
- `[2]` = threshold HOLD: HOLD saat `opponentBalance <= [2]`.
- `[3]` ∈ {0, 1} — kalau 1, selalu HOLD (kecuali FORTIFY).
- `[4..7]` harus **tepat 0**.
- Prioritas ketat: **FORTIFY → HOLD → EXTRACT** dengan
  `amount == params[0]` persis.
- Params semua-nol **tidak bisa dibuktikan** (`params[0]=0` melanggar
  assert range circuit).

Params default repo ini: `[10,0,0,0,0,0,0,0]` (selalu EXTRACT 10).

Nilai golden (dari probing, dipakai sebagai tes regresi di
`test/agent.test.ts`): params `[10,0,0,0,0,0,0,0]` + salt `123456789`
(`0x75bcd15`) → commitment
`0x0bdd4ea66acf04d7ef79f45af72b709020c9269b8452dd6cab33355d866126cd`.

## Digest circuit ≠ publicInputsHash

`publicSignals[0]` (digest circuit) **tidak sama** dengan keccak
`publicInputsHash` mod p, dan bukan pula Poseidon atas 8 field publik
(± salt). Digest adalah nilai internal circuit yang dihitung dari
input yang sama — jadi input yang benar ⇒ digest yang benar. Tidak ada
yang perlu dilakukan; `src/publicInputsHash.ts` tetap dipakai apa adanya
untuk field `publicInputsHash` di respons (rumus itu sudah terverifikasi
benar dari snippet resmi).

## publicInputsHash (sudah benar sejak awal)

Keccak256 dari 8 field 32-byte big-endian, urutan: commitment, matchId,
turn, selfBalance, opponentBalance, kode aksi HOLD=0/FORTIFY=1/EXTRACT=2,
amount, circuitVersion "v1"→1. Implementasi di `src/publicInputsHash.ts`,
persis sesuai snippet resmi di `/build`. Tes membuktikan hash yang
dihitung agent cocok dengan perhitungan independen dari field yang sama.

## Yang masih TIDAK diketahui

- Tidak ada lagi yang menghalangi proof: semua input, semantik, dan
  commitment sudah terbukti dan diimplementasikan (`src/circuitInputs.ts`,
  `src/strategyParams.ts`, `src/poseidon.ts`, `src/proof.ts`).
- Yang belum dikonfirmasi dari sisi platform: format commitment yang
  diminta dashboard saat registrasi agent (tidak ada field commitment di
  form saat turnamen terkunci), dan apakah entri Wildcard butuh
  registrasi/preflight agent atau cukup repo + endpoint + proof reference.
