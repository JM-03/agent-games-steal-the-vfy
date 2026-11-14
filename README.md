# Steal the VFY — Agent untuk zkVerify Agent Games (Wildcard)

Agent TypeScript/Node untuk track **Steal the VFY**. Akun Elgi: `@jmartil1`,
GitHub `JM-03`.

> **STATUS — 14 Nov 2026.** Proof pipeline **sudah jalan penuh**: semua 17
> input circuit terbukti, Groth16 proof digenerate dan di-self-verify
> lokal per turn, demo 20-turn **20/20 proved + verified**.
> Turnamen Steal **sudah terkunci** (8 agent dipasangkan, R1 jalan 13–17 Nov)
> — jadi repo ini diajukan sebagai entri **Wildcard**: demo yang bisa
> dijalankan + proof nyata sebagai bukti, bukan peserta turnamen.

## Masalah yang dipecahkan

- Saldo awal masing-masing **100 VFY** (simulasi, bukan uang asli).
- **20 turn** per match, pemenang = saldo tertinggi.
- Hanya 3 aksi: **FORTIFY** (biaya 2 VFY, blokir sampai 6 VFY ekstraksi
  masuk di turn berikutnya), **EXTRACT** (gratis, curi sampai N VFY,
  maks 10), **HOLD** (gratis, diam).
- Setiap aksi harus dibuktikan dengan ZK proof: aksi itu **diizinkan oleh
  strategi yang sudah di-commit sebelum match** — tanpa membuka isi
  strateginya.

**Klaim zkVerify:** setiap langkah agent terbukti terikat pada strategi
yang di-commit sebelum match — lawan dan wasit bisa memverifikasi tiap
langkah tanpa melihat isi strateginya.

**Di luar game:** polanya umum — agent apa pun yang aksinya harus terbukti
terikat pada kebijakan yang di-commit sebelum bertindak (bot trading yang
dibatasi loss limit, agent governance yang terikat mandat hasil voting,
agent game yang terikat aturan main) bisa commit ke kebijakannya dengan
hash Poseidon dan membuktikan tiap aksi terhadap circuit resmi, tanpa
membuka isi kebijakannya.

## Cara kerja (ringkas)

1. Sebelum match, pemilik memilih 8 angka strategi (`strategyParams`) dan
   salt acak, lalu menghitung
   `commitment = Poseidon(strategyParams[0..7], salt)`.
   Yang dipublikasikan hanya commitment (hash) — params dan salt tetap
   rahasia.
2. Tiap turn, platform kirim envelope bertanda tangan (saldo kedua pihak,
   commitment hash, deadline ~30 detik).
3. Agent memutuskan aksi **persis mengikuti daftar keputusan circuit**
   (prioritas ketat: FORTIFY → HOLD → EXTRACT), generate Groth16 proof
   dari circuit resmi `vfy-policy`, lalu **self-verify proof itu secara
   lokal** sebelum menjawab. Proof yang gagal verifikasi lokal tidak
   pernah dikirim.
4. Jawaban turn: aksi + `publicInputsHash` + proof + `public_signals`,
   semua ditandatangani HMAC. Kalau proof gagal dibuat, agent tetap
   menjawab aksi + hash **tanpa proof** (platform menghitungnya sebagai
   HOLD) — server tidak pernah crash.
5. Proof juga disubmit ke **Kurier** (vk didaftarkan dulu saat server
   start) dan dipoll sampai Finalized.

Semantik strategi (terbukti dari probing circuit resmi, lihat
`CIRCUIT_NOTES.md`):

| Param | Arti |
|---|---|
| `[0]` | Jumlah EXTRACT, 1–10 |
| `[1]` | Threshold FORTIFY: FORTIFY saat selfBalance < `[1]` |
| `[2]` | Threshold HOLD: HOLD saat opponentBalance ≤ `[2]` |
| `[3]` | 0/1 — kalau 1, selalu HOLD (kecuali FORTIFY) |
| `[4..7]` | Harus 0 |

Params default: **`[10,0,0,0,0,0,0,0]`** — selalu EXTRACT 10.
Strategi paling sederhana yang bisa dibuktikan; bukan klaim strategi
menang.

## Yang ada di repo ini

- `src/server.ts` — `GET /health`, `POST /agent` (preflight + turn).
  HMAC diverifikasi dari **raw body** sebelum JSON di-parse; semua respons
  ditandatangani (`x-agent-games-signature`). Saat start, VK didaftarkan
  ke Kurier di background (fire-and-forget, tidak pernah crash server).
- `src/turn.ts` — validasi envelope, cek deadline, cek commitment hash,
  idempotency deterministik **UUIDv5-style dari `matchId:turn`**
  (retry platform mengembalikan respons yang sama; turn baru tidak pernah
  memakai ulang key), dan **fail-safe ke HOLD** pada segala
  error/ketidakpastian. `action.amount` **tidak pernah** dikirim untuk
  HOLD/FORTIFY.
- `src/strategy.ts` — daftar keputusan circuit (`decideActionFromParams`).
- `src/strategyParams.ts` — validasi params (tolak `[0]` di luar 1–10,
  `[3]` bukan 0/1, `[4..7]` bukan 0; params semua-nol ditolak).
- `src/poseidon.ts` — Poseidon via circomlibjs, `computeCommitment`.
- `src/circuitInputs.ts` — semua **17 input** circuit di-wire
  (9 skalar + `strategyParams[0..7]` + salt).
- `src/proof.ts` — `generatePolicyProof()` (snarkjs fullProve + self-verify
  lokal terhadap verification key resmi), `registerKurierVk()`,
  `submitProofToKurier()`, `pollKurierJob()` (endpoint benar:
  `GET /job-status/{KEY}/{jobId}`).
- `src/publicInputsHash.ts` — persis sesuai snippet resmi (keccak256 dari
  8 field, masing-masing 32 byte big-endian).
- `circuits/` — file circuit **asli** dari situs resmi
  (`vfy-policy.wasm`, `vfy-policy_final.zkey`, `circuit-info.json`).
  vk_hash: `0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047`
- `scripts/commitment.cjs` — generate salt acak baru, hitung commitment,
  simpan ke `.env.strategy` (mode 0600, gitignored, salt **tidak pernah**
  dicetak), lalu cek proof untuk tiap branch yang bisa dicapai.
- `scripts/demo-match.cjs` — simulasi match 20 turn lawan scripted
  opponent, proof nyata per turn, ringkasan per turn + total. Kalau
  `KURIER_API_KEY` diset, submit SATU proof ke Kurier.
- `scripts/probe-circuit-inputs.cjs` — alat probing nama input circuit
  (dipakai saat riset; semantik sudah terpecahkan, lihat
  `CIRCUIT_NOTES.md`).

## Menjalankan lokal

```bash
npm install
cp .env.example .env   # isi AGENT_GAMES_HMAC_SECRET dulu
npm run commitment     # generate salt + commitment, tulis .env.strategy
npm test               # 19 tes, semua harus lolos
npm run demo           # simulasi match 20 turn (tanpa Kurier kalau
                       # KURIER_API_KEY tidak diset)
npm run build
npm start              # jalan di http://localhost:3000
```

Cek kesehatan: `curl http://localhost:3000/health`

Hasil terakhir (14 Nov 2026): **19 tes lolos, 0 gagal** — health, preflight
bertanda tangan, tolak signature salah/tanpa signature, turn valid
(EXTRACT 10 + `publicInputsHash` yang cocok), replay `idempotencyKey`
mengembalikan respons identik, key deterministik UUIDv5, FORTIFY/HOLD
tanpa `amount`, deadline kedaluwarsa → HOLD, commitment hash tidak cocok
→ HOLD, aturan strategi circuit, 17 input ter-wire, params tidak valid
ditolak, commitment cocok nilai golden dari probing circuit, proof
EXTRACT/HOLD/FORTIFY yang prove + self-verify, dan aksi yang salah untuk
state-nya **tidak bisa** dibuktikan (circuit assert menolak).

Waktu generate proof per turn (lokal): EXTRACT ~1,7 dtk, HOLD ~0,7 dtk,
FORTIFY ~0,7 dtk. Demo 20 turn: 20/20 proved + verified, total ~13 dtk
(rata-rata ~645 mdtk/turn), skor akhir simulasi 168–28 (menang lawan
opponent scripted).

Catatan: `npm test` memakai `--test-force-exit` karena snarkjs
meninggalkan worker MessagePort terbuka setelah `fullProve`, sehingga
proses Node tidak keluar sendiri. Ini hanya soal test runner — server
produksi memang jalan terus.

## Deploy ke Railway + daftar Wildcard (langkah Elgi)

1. **Upload repo ke GitHub** (akun `JM-03`), pakai isi folder ini
   (jangan upload `.env` / `.env.strategy` — sudah di `.gitignore`).
2. **Railway → New Project → Deploy from GitHub repo** → pilih repo ini.
   Railway memakai `Dockerfile`. Pastikan service tidak tidur saat
   tidak aktif.
3. **Set Variables di Railway** (isi nilai ASLI di Railway saja, jangan
   di chat):
   - `AGENT_GAMES_HMAC_SECRET` — dari dashboard Agent Games
     (Rotate Secret; ditampilkan sekali saja).
   - `KURIER_API_KEY` — API key mainnet Kurier.
   - `STRATEGY_PARAMS` — `[10,0,0,0,0,0,0,0]`
   - `STRATEGY_SALT` — dari `.env.strategy` (salin dengan tangan).
   - `STRATEGY_COMMITMENT_HASH` — dari `.env.strategy`
     (`0x0b9f4672eb0b10bba098b648216126cb6256f43b0879833483b7f4631f61cb39`
     untuk params default + salt yang digenerate 14 Nov 2026).
   - `CIRCUIT_VERSION=v1`, `PROOF_ENABLED=true`.
   - **Setelah ubah Variables, klik "Apply change" → Deploy** — Railway
     tidak auto-deploy perubahan env var.
4. **Dapatkan URL publik Railway**, daftarkan endpoint **lengkap dengan
   path** di dashboard Wildcard: `https://<host-railway>/agent`.
5. **Submit entri Wildcard** dari dashboard: judul proyek, link repo,
   endpoint, deskripsi (apa masalahnya, apa yang dilakukan agent, klaim
   zkVerify di atas + proof reference), deadline **21 Nov 2026**.

## Batasan yang jujur

- **Turnamen Steal sudah terkunci** — entri ini adalah demo + proof untuk
  Wildcard, bukan peserta turnamen.
- **Strategi difiksasi oleh daftar keputusan circuit** — agent tidak bisa
  memakai strategi bebas (mis. reaksi terhadap riwayat lawan); yang bisa
  diubah hanya 8 angka `strategyParams`, dan setiap perubahan butuh
  commitment baru.
- **Params semua-nol tidak bisa dibuktikan** (`params[0]=0` melanggar
  assert range circuit).
- **Digest circuit** (`publicSignals[0]`) adalah nilai internal circuit,
  bukan `publicInputsHash` — input yang benar ⇒ digest yang benar;
  tidak ada yang perlu dilakukan.
- Idempotency disimpan di **Map in-memory** (`src/turn.ts`) — hilang saat
  server restart/redeploy. Untuk produksi sebaiknya pakai store persisten
  (SQLite/Postgres).
- **Dockerfile sudah terbukti build di Railway** — deployment 14 Nov 2026
  (552675ed) build dari Dockerfile ini dan berjalan.

## Keamanan

- Jangan pernah kirim seed phrase / private key / API key / HMAC secret /
  salt lewat chat atau ke model AI. Semua rahasia hanya lewat environment
  variables (`.env` / `.env.strategy` lokal, Variables Railway).
- Jangan commit `.env` / `.env.strategy`. Jangan log rahasia apa pun.
- Manual play dilarang aturan resmi: agent harus menjawab otomatis.
- Satu akun kompetisi per orang/tim, satu GitHub per akun kompetisi.

## Proof reference (placeholder untuk submission Wildcard)

- Repo: https://github.com/JM-03/agent-games-steal-the-vfy
- Endpoint demo: `https://agent-games-steal-the-vfy-production.up.railway.app/agent`
- Circuit vk_hash: `0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047`
- Commitment (params `[10,0,0,0,0,0,0,0]`): `0x0b9f4672eb0b10bba098b648216126cb6256f43b0879833483b7f4631f61cb39`
- Kurier job id (satu proof dari demo, setelah KURIER_API_KEY diset):
  *(isi setelah demo dengan key dijalankan — lihat log demo)*
