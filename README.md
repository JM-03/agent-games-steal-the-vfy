# Steal the VFY — Agent untuk zkVerify Agent Games

Agent TypeScript/Node untuk track **Steal the VFY** (bukan track lain).
Satu agent, satu pemilik. Akun Elgi: `@jmartil1`, GitHub `JM-03`.

> **STATUS JUJUR — baca dulu sebelum deploy.**
>
> Agent ini **siap di bagian transport dan strategi**, tapi **BELUM bisa
> menghasilkan policy proof yang valid**. Penyebabnya: 8 dari 17 nama input
> circuit `vfy-policy` tidak dipublikasikan di halaman resmi mana pun
> (lihat `CIRCUIT_NOTES.md` — sudah dicoba ~500 nama kandidat dengan
> probing langsung ke file circuit-nya, hanya 9 yang ketemu).
>
> Akibatnya, saat ini agent menjawab setiap turn dengan aksi + `publicInputsHash`,
> tapi **tanpa Groth16 proof**. Menurut aturan resmi, turn tanpa proof
> dihitung sebagai **HOLD**. Jadi agent ini hari ini berfungsi sebagai
> peserta yang **selalu HOLD secara skor**, sampai 8 nama input itu diisi
> dari sumber resmi dan `PROOF_ENABLED=true`.
>
> Jangan deploy dengan harapan menang sebelum masalah ini selesai.

## Cara main Steal the VFY (ringkas, dari halaman resmi)

- Saldo awal masing-masing **100 VFY** (simulasi, bukan uang asli).
- **20 turn** per match, pemenang = saldo tertinggi. Swiss **5 ronde**,
  lalu **Top 16 knockout**.
- Hanya 3 aksi: **FORTIFY** (biaya 2 VFY, blokir sampai 6 VFY ekstraksi masuk),
  **EXTRACT** (gratis, curi sampai N VFY, maks 10), **HOLD** (gratis, diam).
- Platform kirim envelope turn yang sudah ditandatangani (saldo kedua belah
  pihak, commitment hash yang dibekukan, deadline). Agent harus jawab
  **~30 detik** per turn, echo `matchId` + `turn`, nyatakan aksi, dan
  lampirkan policy proof (`circuitVersion` + Groth16 proof + `public_signals`).
- Skor: menang +18, seri +9, kalah +3, plus bonus reliabilitas 0–2 dan
  penalti timeout/proof tidak valid 0 sampai −2.
- Hadiah per track: **100.000 VFY** (50.000 / 30.000 / 20.000 untuk juara 1–3).

## Jadwal — ada perbedaan di halaman resmi, jadi dicatat apa adanya

- Tugas awal menyebut turnamen **12–16 Nov 2026**.
- Halaman event yang dibaca langsung pada **13 Nov 2026 12:30 UTC** menulis
  jadwal **13 Nov – 17 Nov 2026**.
- Halaman event juga menulis: **entries lock once the tournament is paired**
  (pendaftaran terkunci begitu turnamen sudah dipasangkan) dan commitment
  strategi harus terdaftar **sebelum Swiss Round 1 dibuka**.
- **Dari halaman resmi saja, tidak bisa dipastikan apakah pendaftaran
  terlambat masih mungkin atau tidak.** Cek di dashboard Elgi: kalau bagian
  Register agent / commitment Steal masih bisa diisi, berarti masih bisa;
  kalau sudah terkunci/paired, berarti sudah telat untuk ronde ini.

## Strategi default (bukan strategi menang)

Satu fungsi di `src/strategy.ts` (`decideAction`), berdasarkan yang bisa
dilihat agent di envelope (turn, saldo, status fortify — tanpa riwayat lawan):

1. Turn ≥ 18 dan tertinggal → **EXTRACT 10**.
2. Lawan sedang fortified di turn ini → **HOLD**.
3. Unggul ≥ 10 dan turn kelipatan 3 → **FORTIFY**.
4. Tertinggal ≥ 10 → **EXTRACT 10**.
5. Selain itu → **EXTRACT 5**.

Panduan resmi sengaja membiarkan strategi sebagai tugas pemiliknya
("leave your strategy as your own to decide"). Default di atas hanya titik
awal. Ubah hanya fungsi `decideAction`, lalu hitung ulang commitment
(`npm run commitment`) dan daftarkan commitment baru **sebelum ronde
berikutnya dipasangkan** — commitment dibekukan di tengah match.

## Yang sudah jadi di repo ini

- `src/server.ts` — `GET /health`, `POST /agent` (preflight + turn).
  HMAC diverifikasi dari **raw body** sebelum JSON di-parse; semua respons
  ditandatangani (`x-agent-games-signature`).
- `src/turn.ts` — validasi envelope, cek deadline, cek commitment hash,
  idempotency per `idempotencyKey` (retry platform mengembalikan respons
  yang sama), dan **fail-safe ke HOLD** pada segala error/ketidakpastian.
  `action.amount` **tidak pernah** dikirim untuk HOLD/FORTIFY.
- `src/strategy.ts` — strategi default di atas (satu file yang jelas).
- `src/publicInputsHash.ts` — `publicInputsHash` persis sesuai snippet
  resmi (keccak256 dari 8 field, masing-masing 32 byte big-endian, urutan:
  commitment, matchId, turn, selfBalance, opponentBalance, kode aksi
  HOLD=0/FORTIFY=1/EXTRACT=2, amount, circuitVersion "v1"→1).
- `src/proof.ts` + `src/circuitInputs.ts` — wiring proof Groth16 (snarkjs)
  dan submit Kurier (REST, `vkRegistered: true`, poll sampai Finalized).
  Saat ini `generatePolicyProof()` **menolak jalan** karena 8 nama input
  masih hilang — ini disengaja, supaya tidak ada proof palsu yang dikirim.
- `circuits/` — file circuit **asli** dari situs resmi (`vfy-policy.wasm`,
  `vfy-policy_final.zkey`, `circuit-info.json`).
  vk_hash: `0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047`
- `scripts/probe-circuit-inputs.cjs` — alat untuk menguji nama input circuit.
- `scripts/commitment.cjs` — hitung hash commitment strategi default.
- Tes: `npm test` — **12 tes, semuanya lolos** (lihat "Tes" di bawah).

## Yang BELUM jadi / masih TODO

1. **8 nama input circuit** — lihat `CIRCUIT_NOTES.md`. Isi hanya dari
   sumber resmi (starter prompt Steal di halaman `/build`, source circuit,
   atau support/Discord zkVerify), lalu set `PROOF_ENABLED=true`.
2. **Deploy + registrasi** — belum dilakukan (butuh akun Elgi, lihat bawah).
3. **Kurier API key** — belum ada; tanpa ini proof tidak bisa disubmit
   untuk verifikasi Finalized.
4. **Dockerfile belum diuji build-nya** — Docker tidak tersedia di mesin
   ini. Railway akan build dari Dockerfile ini; kalau gagal, cek log
   Railway.

## Menjalankan lokal

```bash
npm install
cp .env.example .env   # isi AGENT_GAMES_HMAC_SECRET dulu (lihat bawah)
npm test               # 12 tes
npm run build
npm start              # jalan di http://localhost:3000
```

Cek kesehatan: `curl http://localhost:3000/health`

## Deploy ke Railway + daftar di dashboard (yang harus Elgi lakukan sendiri)

Gue **tidak bisa** melakukan langkah-langkah ini atas nama Elgi — semuanya
butuh akun dan rahasia milik Elgi. Urutannya:

1. **Buat repo GitHub** (akun `JM-03`), upload isi folder ini
   (jangan upload file `.env` — sudah ada di `.gitignore`).
2. **Railway → New Project → Deploy from GitHub repo** → pilih repo ini.
   Railway memakai `Dockerfile` di repo. Pastikan service tidak tidur
   saat tidak aktif (aturan resmi: agent offline = task hangus).
3. **Set Variables di Railway** (dari `.env.example`, isi nilai ASLI di
   Railway saja, jangan di chat):
   - `AGENT_GAMES_HMAC_SECRET` — dari dashboard Agent Games
     (Rotate Secret; ditampilkan sekali saja, simpan baik-baik).
   - `KURIER_API_KEY` — API key mainnet Kurier.
   - `STRATEGY_COMMITMENT_HASH` — hasil `npm run commitment`
     (atau nilai yang diminta dashboard — lihat catatan di script itu).
   - `CIRCUIT_VERSION=v1`, `VK_HASH` sudah ada default-nya.
   - `PROOF_ENABLED` — biarkan `false` sampai 8 input circuit terisi.
4. **Dapatkan URL publik Railway**, misal
   `https://agent-games-steal-the-vfy.up.railway.app`.
   Daftarkan endpoint **lengkap dengan path** di dashboard:
   `https://<host-railway>/agent` (bukan domain saja — path root yang
   404 akan menggagalkan preflight).
5. **Daftarkan strategy commitment** di dashboard:
   Dashboard → My Agents → Edit agent → bagian Steal the VFY.
   Lakukan ini **sebelum Swiss Round 1 dibuka**.
6. **Jalankan preflight** dari dashboard — harus lolos dan agent ditandai
   aktif. Kalau gagal, cek: secret HMAC cocok, URL lengkap dengan `/agent`,
   server hidup.
7. **Jalankan practice turn** (mode practice tidak memengaruhi leaderboard,
   maks 10 dispatch per jam). Periksa log Railway: setiap turn harus
   tercatat `action=... proof=...`.
8. Cek `GET /health` dan halaman **Your Agents** di dashboard.

## Tes

```bash
npm test
```

Hasil terakhir (13 Nov 2026): **12 tes lolos, 0 gagal** — health, preflight
bertanda tangan, tolak signature salah/tanpa signature, turn valid
(EXTRACT 5 + `publicInputsHash` yang cocok), replay `idempotencyKey`
mengembalikan respons identik, FORTIFY/HOLD tanpa `amount`, deadline
kedaluwarsa → HOLD, commitment hash tidak cocok → HOLD, aturan strategi,
dan `buildCircuitInputs` yang menolak jalan selama input circuit belum
lengkap. Smoke test server hasil build (`npm run build` + `node dist/index.js`)
juga lolos: `/health`, preflight, dan satu turn sungguhan.

## Keamanan

- Jangan pernah kirim seed phrase / private key / API key / HMAC secret
  lewat chat atau ke model AI. Semua rahasia hanya lewat environment
  variables (`.env` lokal, Variables Railway).
- Jangan commit file `.env`. Jangan log rahasia apa pun.
- Manual play dilarang aturan resmi: agent harus menjawab otomatis.
- Satu akun kompetisi per orang/tim, satu GitHub per akun kompetisi.
