# Catatan Circuit vfy-policy — apa yang diketahui dan apa yang hilang

## Sumber

- `https://agentgames.zkverify.io/api/circuit-info` (diambil 2026-11-13, salinan di `circuits/circuit-info.json`)
- `https://agentgames.zkverify.io/build` (dibaca 2026-11-13 12:27 UTC)
- `https://agentgames.zkverify.io/events/steal-the-vfy` (dibaca 2026-11-13 12:30 UTC)

## Fakta yang terverifikasi

| Item | Nilai |
|---|---|
| Circuit | `vfy-policy`, Groth16 / BN128, Circom 2.x |
| vk_hash (mainnet) | `0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047` |
| WASM | `https://agentgames.zkverify.io/circuits/vfy-policy.wasm` (2,9 MB, sha256 `bc0998250d2baf75b89deef5306867ffa7085a08d4f7d2caf0dd63a060b134d2`) |
| zkey | `https://agentgames.zkverify.io/circuits/vfy-policy_final.zkey` (792 KB, sha256 `f9666a1655279ef27f7fee6d535ac8aa9e39286ac40ff6279fea87c21ab6ce41`) |
| Jumlah input circuit | **17** (dari snarkjs: "Only 0 out of 17") |
| Public signals (nPublic) | **9** (dari verification key yang diekspor snarkjs) |
| circuitVersion contoh resmi | `"v1"` |

File di `circuits/` diunduh langsung dari URL di atas dan hash-nya cocok
dengan file yang dipakai saat probing.

## 9 nama input yang TERBUKTI ada di circuit

Cara membuktikan: snarkjs hanya menerima nama input yang benar-benar ada
di circuit. Skrip `scripts/probe-circuit-inputs.cjs` menguji satu nama
dengan `groth16.fullProve({ [nama]: "1" }, wasm, zkey)`:

- Nama asli → error `"Not all inputs have been set. Only 1 out of 17"`
  (penghitung input bertambah).
- Nama palsu → error `"Too many values for input signal <nama>"`.

Nama yang lolos:

```
commitment, matchId, selfBalance, opponentBalance, action, amount,
circuitVersion, turnNumber, salt
```

## 8 nama input yang MASIH HILANG

Sekitar **500 nama kandidat** sudah diuji dengan metode yang sama dan
semuanya ditolak, antara lain: `turn`, `strategyCommitment`,
`publicInputsHash`, `nonce`, `strategy`, `policy`, semua varian
threshold/fortify/exposed/spendable, varian snake_case, varian `in_*` /
`policy_*`, nama berawalan angka, dan nama satu huruf.

Delapan nama ini **tidak ada** di halaman `/build`, `/events/steal-the-vfy`,
`/rules`, atau `/guide` yang bisa dibaca, tidak ada di file artifact,
dan tidak ada di starter prompt yang tampil di halaman `/build`
(yang tampil hanya prompt Gatekeeper; prompt Steal ada di balik tab dan
tidak termuat di teks halaman yang diambil).

Kemungkinan besar kedelapan input itu adalah **parameter strategi privat**
(nilai yang hanya diketahui pemilik strategi, dibuktikan tanpa dibuka),
tetapi nama persisnya tidak bisa ditebak dengan aman — nama yang salah
membuat proof tidak valid, dan proof tidak valid lebih buruk daripada
tidak ada proof.

## Cara mengisi yang hilang (hanya dari sumber resmi)

1. Buka `https://agentgames.zkverify.io/build` di browser, klik tab
   **Steal the VFY** pada bagian starter prompt, salin prompt-nya —
   prompt itu kemungkinan memuat nama input circuit.
2. Atau minta source circuit / skema input dari support atau Discord
   zkVerify.
3. Atau jalankan `npm run probe -- <nama1> <nama2> ...` untuk menguji
   nama kandidat baru dengan metode di atas.

Setelah ketemu:

1. Tambahkan nama-namanya ke `KNOWN_INPUTS` di `src/circuitInputs.ts`,
   tambahkan nilainya di `buildCircuitInputs()`, dan kosongkan
   `MISSING_INPUT_NAMES`.
2. Set `PROOF_ENABLED=true` di `.env` / Railway Variables.
3. Jalankan `npm test` dan satu practice turn sebelum ronde berbobot.

## publicInputsHash (ini TIDAK hilang)

Rumus hash ini lengkap dan sudah diimplementasikan di
`src/publicInputsHash.ts`, persis sesuai snippet resmi di `/build`
(keccak256 dari 8 field 32-byte big-endian, urutan: commitment, matchId,
turn, selfBalance, opponentBalance, kode aksi HOLD=0/FORTIFY=1/EXTRACT=2,
amount, circuitVersion "v1"→1). Tes di `test/agent.test.ts` membuktikan
hash yang dihitung agent cocok dengan perhitungan independen dari
field-field yang sama.
