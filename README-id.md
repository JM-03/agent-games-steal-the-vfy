# Steal the VFY — setiap langkah terbukti terikat pada strategi yang sudah di-commit

Agent TypeScript/Node untuk track **Steal the VFY** di zkVerify Agent Games (Wildcard). Dibuat oleh Gogo Maduro (`@jmartil1`, GitHub `JM-03`) dengan jink. Versi Inggris: [`README.md`](README.md).

**Commit sekali, buktikan setiap langkah.**

| | |
|---|---|
| Coba demonya (tanpa install) | [halaman demo](https://jm-03.github.io/agent-games-steal-the-vfy/demo.html) — coba curangi sendiri, replay 20 turn, treasury guard, demo refusal |
| Verifikasi satu proof asli (tanpa kode repo) | `npm run verify:proof` — satu proof turn-1 lawan VK resmi (`evidence/proof-turn-1/`) |
| Lihat agent mencoba curang | `npm run demo:refusal` — 3/3 langkah di luar policy ditolak circuit |
| Tonton video demonya | [demo-video.mp4](docs/demo-video.mp4) — 84 dtk: match 20 turn 20/20 proved, US WIN 168–28, plus demo refusal 3/3 |
| Endpoint live | `https://agent-games-steal-the-vfy-production.up.railway.app/agent` (401 tanpa signature = fail-closed) |
| Write-up-nya | [`WRITEUP.md`](WRITEUP.md) — argumennya dalam 1.234 kata |

## TL;DR

- **Masalah:** agent yang pegang wallet bisa memindahkan uang tanpa bisa diaudit — log-nya sendiri tidak membuktikan apa-apa.
- **Entri ini:** setiap langkah dibuktikan, dalam zero knowledge, tetap berada di dalam strategi yang sudah di-commit sebelum bertindak.
- **Bukti:** Groth16 per langkah lewat circuit resmi `vfy-policy`, diverifikasi di zkVerify mainnet lewat Kurier — langkah yang salah tidak punya proof sama sekali; circuit menolak dan agent menjawab HOLD.
- **Evidence:** demo 20/20 proved, defensive 40/40, refusal 3/3, treasury guard 3/3, tes 24/24 — semuanya bisa direproduksi dengan satu command.
- **Coba:** `npm run demo` — atau verifikasi satu proof asli dengan `npm run verify:proof`, tanpa perlu kode repo.
- **Batasan:** turnamen Steal terkunci (demo Wildcard); job Kurier Finalized `2d523ed8-e255-11f1-838e-1e6a0d14f999` (17 Nov 2026).

## Status

Sudah jadi: proof pipeline (17/17 input, Groth16 per turn, self-verified), demo 20/20, defensive 40/40, refusal 3/3, attack script 5/5, tes 24/24, halaman demo publik.
Kurier: job Finalized pertama untuk Steal, id `2d523ed8-e255-11f1-838e-1e6a0d14f999` (demo fresh 17 Nov 2026, 20/20, Finalized).
Turnamen: entri Steal terkunci — ini demo Wildcard, bukan peserta turnamen.

Musuh di sini bukan "agent jahat" — tapi **agent yang tidak bisa dibuktikan**: agent black-box yang pegang kunci treasury, di mana satu langkah di luar mandatnya bisa menguras dana dan tidak ada yang bisa membuktikan siapa yang salah.

Ini sudah pernah terjadi, di depan publik: **Freysa (Nov 2024)** — agent AI yang menjaga prize pool di Base, dengan satu aturan ("jangan pernah transfer dana dalam keadaan apa pun") — berhasil dibujuk untuk memanggil `approveTransfer` dan mengirim seluruh pool sekitar **$47.000** ke seorang peserta pada percobaan ke-482 (195 peserta; dilaporkan Cointelegraph dan The Block, 29 Nov 2024). Agent itu tidak di-hack. Dia dibujuk.

Aturan yang ditulis di prompt bukan batas — batas adalah sesuatu yang agent *tidak bisa* lewati, bahkan saat dia mau. Untuk itulah circuit ada.

## Coba — satu command

```bash
npm install && npm run build && npm run demo
# 20/20 turn proved + locally verified, ~13 dtk, final 168–28
```

```
turn  1: us EXTRACT 10  | opp EXTRACT 5   | proof=proved-not-finalized | 1325ms | balances 100->105 / 100->95
turn  2: us EXTRACT 10  | opp EXTRACT 5   | proof=proved-not-finalized | 626ms | balances 105->110 / 95->90
turn  3: us EXTRACT 10  | opp EXTRACT 5   | proof=proved-not-finalized | 707ms | balances 110->115 / 90->85
...
Totals: 20/20 turns proved + locally verified, 12608ms total, avg 630ms/turn.
Final balances: us 168 — opponent 28 → US WIN.
```

Demo defensive — pola commitment yang sama, strategi berbeda
(`[5,50,20,0,0,0,0,0]`, commitment `0x1b63…a2a24`):

```bash
npm run demo:defensive
```

Dua match 20 turn, satu commitment. Skenario A (diserang) memicu FORTIFY 9 kali; skenario B (lawan pasif) memicu HOLD 4 kali. Output (disingkat):

```
Scenario A — under attack: 20/20 proved, EXTRACT x11, FORTIFY x9, HOLD x0. Final: us 22 — opponent 160 → OPPONENT WIN.
Scenario B — draining a passive opponent: 20/20 proved, EXTRACT x16, FORTIFY x0, HOLD x4. Final: us 180 — opponent 20 → US WIN.
DEFENSIVE DEMO OK: 40/40 turns proved + locally verified across both matches (EXTRACT x27, FORTIFY x9, HOLD x4).
```

Skenario A kalah poin — memang itu poinnya: branch defensive menyala 9 kali dan setiap langkah tetap terbukti. Satu match 20 turn tidak bisa menunjukkan kedua branch defensive (FORTIFY butuh saldo kita jatuh sementara HOLD butuh saldo lawan jatuh), jadi demonya memainkan dua match di bawah satu commitment daripada memalsukannya dalam satu match. Salt defensive ada di `.env.strategy-defensive` (gitignored, mode 0600) — tidak pernah di repo, tidak pernah di `.env.strategy` utama.

Lalu `npm run demo:refusal` untuk melihat langkah ilegal gagal (lihat di bawah).

Atau tonton video demo 84 detik: [▶ Tonton video demo (84 dtk)](docs/demo-video.mp4)

> Catatan: video direkam tanpa Kurier key, jadi langkah Kurier dilewati di video memang sengaja. Bukti on-chain-nya berasal dari run keyed terpisah dari demo yang sama — job `2d523ed8-e255-11f1-838e-1e6a0d14f999`, status Finalized (lihat "Terverifikasi di mainnet" di bawah).

## Evidence

Setiap angka di halaman ini bisa direproduksi dengan satu command (`npm run demo` / `npm test`).

| Cek | Hasil | Cara verifikasi |
|---|---|---|
| Video demo (84 dtk) | Match 20 turn 20/20 proved, US WIN 168–28, plus demo refusal 3/3 | [docs/demo-video.mp4](docs/demo-video.mp4) |
| Demo match (20 turn, proof asli) | 20/20 proved + locally verified, ~13 dtk, final 168–28 | `npm run demo` |
| Demo refusal (3 langkah di luar policy) | 3/3 ditolak circuit; agent menjawab HOLD | `npm run demo:refusal` |
| Demo defensive (FORTIFY + HOLD live) | 40/40 proved + locally verified; FORTIFY x9, HOLD x4 | `npm run demo:defensive` |
| Test suite | 24/24 lolos | `npm test` |
| Cek proof independen (tanpa kode repo) | snarkJS OK — satu proof turn-1 asli terverifikasi lawan VK resmi | `npm run verify:proof` |
| Demo treasury guard (3 contoh) | 3/3 berperilaku sesuai commitment (1 ditolak, 1 proved, 1 ditolak allowlist) | `npm run demo:treasury` |
| Attack script (5 serangan) | 5/5 diblokir (commitment dirusak, replay, strategy swap, proof palsu, envelope tanpa signature) | `npm run attack` |
| Reveal strategi demo | Commitment yang dihitung ulang COCOK dengan yang dipublikasikan | `npm run reveal:demo` |
| Kenapa zkVerify (biaya verifikasi) | ~272k gas per proof di Ethereum; sampai 90% lebih murah lewat zkVerify | Lihat "Kenapa zkVerify — dalam angka" |
| Job Kurier Finalized (satu proof dari demo) | Finalized — job `2d523ed8-e255-11f1-838e-1e6a0d14f999` (17 Nov 2026, demo 20/20) | `npm run demo` dengan key diset |
| Endpoint live | `https://agent-games-steal-the-vfy-production.up.railway.app/agent` — preflight + turn bertanda tangan; request tanpa signature ditolak 401 (perilaku fail-closed yang benar) | `curl .../health` |

## Tes refusal — lihat agent mencoba curang dan gagal

```bash
npm run demo:refusal
```

Demo ini mencoba tiga langkah di luar policy terhadap strategi yang benar-benar di-commit dan circuit yang asli, lalu menunjukkan apa yang sebenarnya dilakukan agent. Output (disingkat):

```
ATTEMPT 1: prove EXTRACT 11 (committed cap is 10) ...
  CIRCUIT REFUSED: Error: Assert Failed. Error in template VfyPolicyProof_154 line: 149
  -> No proof exists for this move. Nothing to send, nothing to verify.

ATTEMPT 2: prove EXTRACT 10 when opponent balance is 0 (strategy says HOLD) ...
  CIRCUIT REFUSED: Error: Assert Failed. Error in template VfyPolicyProof_154 line: 140
  -> No proof exists for this move. Nothing to send, nothing to verify.

ATTEMPT 3: replay turn 1's valid proof as turn 2's proof ...
  turn 1 proof vs turn 1 signals: valid
  turn 2 proof vs turn 2 signals: valid
  turn 1 proof vs turn 2 signals: INVALID — replay rejected
  -> Public signals bind matchId + turnNumber, so a proof made for turn N does not verify for turn M.

RETRY: same turn 1 envelope sent twice (platform retry) ...
  identical response: yes  | idempotencyKey: 8f1fe0e2-9b28-5a2f-b58a-cfa570da0930
  -> A retry returns the cached response. The agent never proves the same turn twice.

AGENT ANSWER for that same turn (turn 2, opponent balance 0):
  action: HOLD  | proof: yes (valid, self-verified)  | proofStatus: proved-not-finalized
  -> The agent never sends the refused move. It answers the in-policy action (HOLD) and proves that one instead.

FAIL-CLOSED: turn envelope with a tampered commitment hash ...
  action: HOLD  | proof: no  | proofStatus: no-proof
  -> The agent answers HOLD with no proof instead of guessing or sending an unproven move.

REFUSAL DEMO OK: 3/3 out-of-policy moves refused by the circuit (over-cap, wrong-branch, replay), agent answered HOLD in both fail-closed cases.
```

Verifikasi adalah gerbangnya, bukan lencana: tanpa proof, langkah itu tidak terjadi.

AutoSRE menang juara 1 di track Dynatrace pada Google Cloud Rapid Agent Hackathon 2026 (1.425 submission) dengan tesis yang sama — "penolakan adalah produknya." Jejak audit entri ini adalah receipt Kurier Finalized: setiap langkah yang disetujui meninggalkan catatan yang bisa dicek di zkVerify mainnet. (Langkah yang ditolak tidak menghasilkan proof, jadi tidak ada receipt untuk penolakan — output demo di atas adalah buktinya.)

## Masalahnya

*Setiap langkah agent harus terbukti terikat pada strategi yang sudah di-commit pemiliknya — atau jangan gerakkan uang.*

Ini adalah entri **SECURITY** dari daftar inspirasi event itu sendiri — guard wallet & transaksi — dengan policy disembunyikan oleh commitment Poseidon dan ditegakkan oleh Groth16 proof. Ini adalah cerminan dari contoh resmi: bukan memberi akses saat proof menunjukkan credential, agent ini *bertindak* hanya saat proof menunjukkan aksinya diizinkan oleh policy yang sudah di-commit.

Polanya sudah mapan: Mandate (sponsor prize, ETHOnline 2026), MARS (juara 1, ETHGlobal New York 2026), Petri (finalis ETHOnline 2026) dan Identone (juara 1, cheqd Verifiable AI Hackathon 2025) semuanya mengikat otoritas agent dan menaruh verifikasi di depan setiap aksi. Yang ditambahkan entri ini adalah penegakan dengan kriptografi asli: Groth16 proof yang diverifikasi di zkVerify mainnet, dalam match adversarial yang live — dan game adalah ujian tersulit untuk pola ini: lawan yang adversarial, commitment yang publik, dan wasit yang tidak bisa disuap. Di luar game, proof yang sama berlaku untuk agent apa pun yang aksinya harus terbukti terikat pada policy — bot trading yang dibatasi loss limit, agent governance yang terikat mandat hasil voting, wallet guard yang terikat allowlist.

**Slot validasi masih kosong.** ERC-8004, standar Ethereum "Trustless Agents" yang diusulkan Agustus 2025 (MetaMask, Ethereum Foundation, Google, Coinbase), mendefinisikan tiga registry — Identity, Reputation, dan Validation, di mana validator independen mengembalikan skor plus proof bahwa agent melakukan apa yang diklaimnya. Identity dan Reputation sudah live di mainnet sejak Januari 2026, tapi Validation Registry ditarik kembali untuk dikerjakan ulang dan tidak ada di set mainnet resmi. Entri ini mengisi slot itu secara konkret: validator yang mengembalikan ZK proof per langkah bahwa langkah itu tetap di dalam strategi yang sudah di-commit. (Ini bukan klaim patuh ERC-8004 — tidak ada registrasi sungguhan; ini implementasi dari slot validasi yang didefinisikan standar itu.)

## Apa yang dijamin, dan apa yang menegakkannya

Bahkan dengan kode, key, salt, dan strategi agent di tangan, penyerang tetap hanya bisa membuktikan langkah yang diizinkan policy yang sudah di-commit. Agent yang sepenuhnya dikompromikan paling banyak bisa mengekstrak 10 VFY per turn, dan hanya saat strategi yang sudah di-commit mengizinkannya — dia tidak bisa mengarang langkah, mengganti strategi di tengah match, atau memakai ulang proof.

Halaman /build zkVerify sendiri mengatakannya begini: *"Proof bisa terverifikasi sempurna tapi tetap mengotorisasi aksi yang salah. Agent-mu harus mengonfirmasi apa yang dibuktikan, bukan hanya apakah verifikasinya berhasil."* ("Verifikasi itu perlu, tapi tidak cukup.") Sebelum bertindak, agent ini mengecek apa yang dibuktikan proof itu — tujuh cek yang sama yang disyaratkan halaman /build:

| Jaminan | Ditegakkan oleh |
|---|---|
| Agent yang dikompromikan hanya bisa membuktikan langkah yang diizinkan policy yang sudah di-commit | Assert circuit atas params yang sudah di-commit dan daftar keputusan yang ketat (FORTIFY → HOLD → EXTRACT); langkah di luar daftar tidak punya proof sama sekali |
| Proof tidak bisa dipakai ulang untuk turn lain | Public signals mengikat `matchId` + `turnNumber`; retry platform mengembalikan respons yang di-cache lewat idempotency key deterministik |
| Commitment palsu di envelope ditolak | Commitment-hash mismatch → HOLD tanpa proof |
| Proof dari circuit atau key yang ditukar tidak pernah dikirim | Proof digenerate dan di-self-verify lawan circuit resmi vfy-policy (Groth16/bn128), VK `0x6c56…be047`; yang lain gagal verifikasi lokal |
| Task kedaluwarsa atau signature palsu ditolak | HMAC diverifikasi dari raw body sebelum JSON di-parse; deadline kedaluwarsa fail-closed ke HOLD |
| Proof gagal berarti tidak ada langkah | Agent menjawab HOLD tanpa proof daripada menebak |
| Setiap langkah bisa dicek siapa pun — dan strategi tetap rahasia | Setiap proof + public signals terverifikasi lawan circuit resmi; proof disubmit ke Kurier dan dipoll sampai Finalized sebelum dihitung sebagai evidence on-chain; commitment adalah public input di setiap proof, dan hanya commitment Poseidon yang pernah dipublikasikan — juri yang ditunjukkan strateginya bisa menghitung ulang |
| Setiap respons ditandatangani | `x-agent-games-signature` di setiap respons |

## Kenapa zkVerify — dalam angka

Mempercayai log agent sendiri biayanya $0 dan tidak membuktikan apa-apa; memverifikasi setiap langkah di zkVerify membuatnya bisa dicek siapa pun, selamanya.

- Satu Groth16 proof (BN254) berukuran **256 byte** (uncompressed: dua titik G1 + satu titik G2).
- Memverifikasi satu proof kami langsung di Ethereum biayanya ≈ **272.000 gas** untuk 9 public input, menurut formula Horizen Labs: ~207.700 gas tetap + ~7.160 gas per public input (207.700 + 9 × 7.160 = 272.140).
- zkVerify memangkas biaya verifikasi sampai **90%** dibanding Ethereum (Delphi Digital; Horizen Labs).

Setiap langkah di repo ini membawa proof seperti itu — 20 per match, 60 di tiga demo match — dan masing-masing bisa diverifikasi secara independen di zkVerify mainnet.

## Terverifikasi di mainnet, bukan cuma oleh agent itu sendiri

Proof yang hanya diverifikasi oleh kode agent itu sendiri tidak membuktikan apa-apa ke orang lain — agent bisa memverifikasi apa pun yang dia mau dan mencetak "valid". Self-verifikasi lokal hanyalah gerbang pertama di repo ini: proof yang gagal di situ tidak pernah dikirim. Cek yang penting terjadi di zkVerify mainnet, di mana proof disubmit lewat Kurier dan dipoll sampai Finalized — oleh verifier yang tidak dikendalikan agent.

Jalur submit-and-poll yang sama sudah mengembalikan job Finalized di ronde Gatekeeper live yang dinilai (tiga job, 13 Nov). Job Finalized pertama untuk Steal adalah `2d523ed8-e255-11f1-838e-1e6a0d14f999` — demo fresh 17 Nov 2026 (20/20, US WIN 168–28), dipoll sampai Finalized:
`Kurier job submitted, jobId=2d523ed8-e255-11f1-838e-1e6a0d14f999, status=Submitted`
`Kurier job 2d523ed8-e255-11f1-838e-1e6a0d14f999 final status: Finalized`

**Server kami sendiri tidak pernah bisa menghasilkan VERIFIED — hanya Kurier / zkVerify mainnet yang bisa.** Itulah gunanya artefak proof yang di-commit: satu proof asli, diekspor supaya siapa pun bisa mengeceknya tanpa menjalankan satu baris pun kode repo ini — `npm run verify:proof` (lihat `evidence/proof-turn-1/README.md`).

## Apa yang tidak dibuktikan entri ini

Jujur soal batas adalah bagian dari entrinya (polanya dari Petri, finalis ETHOnline 2026). Proof adalah pernyataan yang presisi — ini yang bukan:

- **Job Kurier Finalized membuktikan proof terverifikasi — bukan bahwa strateginya bijak.** EXTRACT 10 setiap turn adalah policy treasury yang buruk dan bisa dibuktikan dengan sempurna. Verifikasi mengecek kepatuhan terhadap commitment, bukan kualitas policy.
- **Self-verifikasi lokal membuktikan proof terbentuk dengan benar — bukan bahwa ceknya independen.** Verifier yang dikendalikan prover bukan independen; independensi hanya datang dari Kurier / zkVerify mainnet. Itulah kenapa receipt Finalized penting — dan job id Steal sekarang sudah Finalized (lihat "Terverifikasi di mainnet" di atas).
- **Demo match membuktikan mekanismenya — bukan bahwa EXTRACT 10 menang di game sungguhan.** Demo ini simulasi lokal lawan opponent scripted; proof-nya asli, skornya bukan hasil turnamen. Demo defensive bahkan kalah satu match poin (22–160) — sengaja: yang penting branch-nya, bukan skornya.
- **Commitment menyembunyikan strategi dari juri — mereka hanya bisa memverifikasinya lewat recompute.** Tidak ada yang bisa membaca policy dari commitment; juri yang ditunjukkan strateginya bisa menghitung ulang (`scripts/commitment.cjs` untuk bentuknya, `scripts/reveal-demo.cjs` untuk strategi demo) dan mengonfirmasi cocok. Privasi dan ketercekan sama-sama nyata, dan trade-off-nya tepat di sini.
- **Proof membuktikan langkah ini mengikuti policy — bukan bahwa policy mencakup semua risiko.** Circuit tahu saldo dan cap; dia tidak tahu alamat, counterparty, atau harga pasar. Cek allowlist ada di guard layer, bukan di circuit — halaman demo memberi label mana yang mana.

## Bagaimana ini dibandingkan

Ada lebih dari satu cara membuat perilaku agent bisa dicek. Entri ini memilih ZK proof atas kepatuhan policy — pilihan yang disengaja di antara alternatif yang nyata, bukan default:

| Pendekatan | Apa yang dibuktikan | Apa yang harus dipercaya | Kapan cocok |
|---|---|---|---|
| **Entri ini: ZK proof per langkah atas commitment** | Bahwa langkah ini diizinkan oleh strategi yang sudah di-commit pemiliknya sebelum bertindak | Circuit dan commitment (keduanya publik) — tidak ada soal agent saat runtime | Saat policy harus rahasia tapi setiap aksi harus bisa dicek siapa pun |
| Policy Vault (chandrabosep) | Bahwa pembayaran vault mengikuti policy yang ditandatangani, diverifikasi di Base Sepolia testnet | Circuit custom dengan trusted setup satu kontribusi | Pola yang sama, scope testnet; entri ini memakai circuit resmi di mainnet |
| Mandate (sponsor prize, ETHOnline 2026) | Bahwa spend treasury sudah dibersihkan oleh verifier | Layanan verifier itu sendiri ("virtual verifier", bukan kriptografi publik) | Saat layanan verifier yang dipercaya bisa diterima |
| Agent berbasis TEE (Oasis ROFL, NEAR Shade, Phala) | Bahwa kode yang benar sedang berjalan, diattestasi hardware | Vendor hardware (Intel SGX/TDX, NVIDIA) dan rantai attestasinya | Saat attestation hardware tersedia dan dipercaya |
| Signing policy gaya Lit (Lit Protocol, Vincent) | Bahwa hanya signer yang diotorisasi yang bisa sign, di bawah policy yang ditegakkan saat signing | Threshold network / TEE yang memegang key shares | Saat pertanyaannya *siapa yang boleh sign* |
| Agent + audit log | Tidak ada yang independen — log hanya bilang apa yang diklaim agent | Log agent itu sendiri | Tidak pernah, untuk uang: log yang ditulis agent tentang dirinya sendiri tidak membuktikan apa-apa |
| Proof yang hanya diverifikasi kode agent itu sendiri | Bahwa proof terbentuk dengan benar — bukan siapa yang mengeceknya | Agent yang menghasilkan proof | Tidak pernah, sebagai evidence ke pihak ketiga: verifier yang dikendalikan prover bukan independen |
| tiny-chess (Uton10/tiny-chess-agent) | Bahwa langkah catur terikat pada step yang sudah di-commit (commit-then-reveal) | Circuit custom dengan setup kelas demo; proof mengikat langkahnya, bukan apakah langkah itu legal atau output engine | Pola umum (commit-then-reveal) yang kami pinjam untuk demo reveal; tapi klaim Kurier-nya placeholder literal (`PROOF_REFERENCE`), tidak ada demo live dan tidak ada tes |
| Whale Sentinel (whale99999/agent-games-agent) | Bahwa langkah Steal mengikuti strategi `[10,0,0,0,0,0,0,0]` yang sama, circuit resmi untuk Gatekeeper + Steal | Kode agent itu sendiri — tanpa Kurier, tanpa halaman demo, tanpa demo refusal, tanpa write-up; tes memakai dummy VK (`0xaaaa…`) | Strategi sama, evidence lebih tipis: entri ini menambah pipeline Kurier, demo refusal + attack, dan halaman demo publik |
| ClaimGuard (jeffmarket12/claimguard) | Bahwa preview claim free-mint BSC bersih — dicek oleh gate code-nya sendiri, bukan oleh proof | Gate code dan respons RPC yang ditindakinya; README-nya sendiri menyatakan: "No proof exists. Nothing here is verified on zkVerify today" | Guard asli dengan evidence yang jujur (4/4 dry run, 14 tes) — tapi verifikasinya masih desain; proof entri ini adalah Groth16 proof asli atas circuit resmi |
| Agent Steal Camotir7f (Camotir7f/steal-the-vfy-agent) | Bahwa turn Steal mengikuti strategi yang sudah di-commit — circuit resmi yang sama, proof bersarang di `policyProof` | Kode agent itu sendiri — 35 tes, tapi strateginya masih placeholder TODO (params semua-nol, yang ditolak circuit untuk dibuktikan) dan Kurier testnet di panduan deploy-nya | Paralel teknis terdekat — bentuk proof sama, belum ada strategi yang di-commit; entri ini commit ke strategi asli dan menjalankannya (demo 20/20, refusal 3/3) |

### Bedanya dengan guard proof-of-arithmetic

Beberapa entri agent yang bisa diverifikasi membuktikan aritmatika atas flag yang dihitung server-nya sendiri — misalnya wallet guard yang memberi skor transaksi dari sejumlah cek dan membuktikan `score = weighted sum of flags`. Proof-nya asli, tapi yang dibuktikan adalah penjumlahannya, bukan faktanya: server yang dikompromikan bisa menyetel semua flag ke 0 dan tetap menghasilkan proof "SAFE" yang valid, dan verdict BLOCK hanya label di respons — setiap input punya proof yang valid, termasuk untuk penolakan. Tidak ada yang benar-benar ditolak.

Entri ini membuktikan hal lain: bahwa langkah itu diizinkan oleh policy yang sudah di-commit pemiliknya sebelum bertindak. Circuit menegakkan keputusannya sendiri, jadi langkah yang salah tidak punya proof sama sekali — penolakannya kriptografis, bukan label. Proof-nya juga dicek oleh verifier yang tidak dikendalikan agent (Kurier / zkVerify mainnet), policy tetap tersembunyi di balik commitment Poseidon, dan proof yang gagal berarti langkah itu tidak terjadi (fail-closed).

| | Guard proof-of-arithmetic | Entri ini |
|---|---|---|
| Apa yang dibuktikan proof | Bahwa `score = weighted sum of flags` (aritmatika atas input yang dihitung server di luar circuit) | Bahwa langkah ini diizinkan oleh policy yang sudah di-commit (circuit menegakkan keputusannya sendiri) |
| Circuit | Biasanya custom, dengan trusted setup buatan author-nya | Circuit resmi `vfy-policy`, tanpa setup buatan sendiri |
| Verifikasi on-chain | Sering tidak ada — proof hanya diverifikasi lokal | Disubmit ke Kurier / zkVerify mainnet; job Gatekeeper Finalized (tiga, 13 Nov); job Steal pertama Finalized (`2d523ed8-e255-11f1-838e-1e6a0d14f999`, 17 Nov 2026) |
| Saat proving gagal | Verdict tetap dikembalikan, tanpa proof (best-effort) | Agent menjawab HOLD tanpa proof (fail-closed); langkah itu tidak terjadi |
| Penolakan | Label di respons — setiap input punya proof yang valid, termasuk untuk penolakan | Kriptografis: langkah yang salah tidak punya proof sama sekali (circuit assert), didemonstrasikan live di `npm run demo:refusal` |
| Privasi policy | Biasanya semua input publik — policy terlihat | Policy tersembunyi di balik commitment Poseidon; bisa diverifikasi lewat recompute |
| Juri bisa mencoba | Form demo live adalah cara tercepat menunjukkan guard | Halaman demo publik + `npm run demo` + `npm run verify:proof` (satu proof asli, tanpa kode repo) |

Contoh paling jelas dari pendekatan proof-of-arithmetic di antara entri Wildcard yang bisa dibaca adalah Sentinel Guard ([markastrader/sentinel-guard](https://github.com/markastrader/sentinel-guard)) — guard wallet & transaksi dengan demo live yang bisa dicoba juri dalam 30 detik, yang memang poin terkuatnya. Perbandingan di atas soal pendekatannya, bukan proyeknya.

Spektrumnya, dikatakan terus terang: TEE adalah proof lewat hardware, skema bond/slashing adalah proof lewat ekonomi, konsensus multi-model adalah proof lewat kesepakatan sosial — dan ZK proof adalah proof lewat matematika tentang keputusan itu sendiri. Entri ini memilih ZK karena tidak butuh percaya pada vendor hardware atau threshold node: proof-nya terverifikasi lawan commitment publik atau tidak. Batas yang jujur: TEE membuktikan *kode yang benar sedang berjalan*; entri ini membuktikan *langkah yang benar yang diambil*. Keduanya komplementer, bukan bersaing — TEE tidak bisa membuktikan langkah tetap di dalam policy yang sudah di-commit, dan ZK policy proof tidak bisa membuktikan kode apa yang menghasilkannya.

## Cara kerja (ringkas)

```mermaid
flowchart LR
    A[Commit once: Poseidon(params, salt) published] --> B[Signed turn envelope arrives]
    B --> C[Decide: FORTIFY → HOLD → EXTRACT]
    C --> D[Prove: Groth16 from official vfy-policy circuit]
    D --> E{Self-verify locally vs official VK}
    E -->|passes| F[Answer with proof + public signals]
    E -->|fails| G[Answer HOLD, no proof]
    F --> H[Kurier: submit in background → Finalized]
    D -->|circuit refuses| G
```

1. Sebelum match, pemilik memilih 8 angka strategi (`strategyParams`) dan salt acak, lalu menghitung `commitment = Poseidon(strategyParams[0..7], salt)`. Yang dipublikasikan hanya commitment (hash) — params dan salt tetap rahasia.
2. Tiap turn, platform mengirim envelope bertanda tangan (saldo kedua pihak, commitment hash, deadline ~30 detik).
3. Agent memutuskan aksi **persis mengikuti daftar keputusan circuit** (prioritas ketat: FORTIFY → HOLD → EXTRACT), menggenerate Groth16 proof dari circuit resmi `vfy-policy`, lalu **self-verify proof itu secara lokal** sebelum menjawab. Proof yang gagal verifikasi lokal tidak pernah dikirim.
4. Jawaban turn: aksi + `publicInputsHash` + proof + `public_signals`, semua ditandatangani HMAC. Kalau proof tidak bisa dibuat, agent tetap menjawab aksi + hash **tanpa proof** (platform menghitungnya sebagai HOLD) — server tidak pernah crash.
5. Proof juga disubmit ke **Kurier** (VK didaftarkan dulu saat server start) dan dipoll sampai Finalized.
6. **Reveal (demo saja):** setelah match, pemilik bisa membuka strategi DEMO — params + salt — dan siapa pun menghitung ulang commitment-nya (`npm run reveal:demo`). Polanya bernama **commit → act → reveal**: commit sebelum bertindak, buktikan setiap tindakan, reveal setelah match supaya commitment bisa dicek. Hanya commitment demo yang pernah dibuka; salt strategi utama tetap rahasia selamanya.

Semantik strategi (terbukti dari probing circuit resmi, lihat `CIRCUIT_NOTES.md`):

| Param | Arti |
|---|---|
| `[0]` | Jumlah EXTRACT, 1–10 |
| `[1]` | Threshold FORTIFY: FORTIFY saat selfBalance < `[1]` |
| `[2]` | Threshold HOLD: HOLD saat opponentBalance ≤ `[2]` |
| `[3]` | 0/1 — kalau 1, selalu HOLD (kecuali FORTIFY) |
| `[4..7]` | Harus 0 |

Params default: **`[10,0,0,0,0,0,0,0]`** — selalu EXTRACT 10. Strategi paling sederhana yang bisa dibuktikan; bukan klaim strategi menang.

## Yang ada di repo ini

- `src/server.ts` + `src/turn.ts` — endpoint, HMAC raw-body, fail-closed HOLD, idempotency.
- `src/proof.ts` + `src/circuitInputs.ts` — Groth16 prove + local self-verify lawan VK resmi; submit + poll Kurier.
- `src/strategy.ts` + `src/poseidon.ts` — daftar keputusan + commitment Poseidon.
- `scripts/demo*.cjs` — demo match, defensive, refusal, treasury, attack, reveal (`npm run demo*`).
- `evidence/` — satu proof turn-1 asli + VK, bisa diverifikasi tanpa kode repo (`npm run verify:proof`).
- Daftar file lengkap: lihat `src/` dan `scripts/`.

## Di mana melihatnya di kode

| Apa | Di mana |
|---|---|
| Cek commitment: hash envelope harus cocok, kalau tidak HOLD | `src/turn.ts:209-211` |
| Circuit menolak langkah yang salah — `generatePolicyProof` throw, tidak pernah mengembalikan proof yang belum terverifikasi | `src/proof.ts:75` (`fullProve`), `:84` (local `groth16.verify`) |
| Replay mengembalikan respons yang di-cache, tidak pernah proof baru | `src/turn.ts:103` (`deriveIdempotencyKey`, SHA-256 atas `matchId:turn`) |
| Submit + poll Kurier sampai Finalized | `src/proof.ts:155` (`submitProofToKurier`), `:193` (`pollKurierJob`) |
| Daftar keputusan FORTIFY → HOLD → EXTRACT | `src/strategy.ts:78-85` (`decideActionFromParams`) |
| Artefak circuit resmi yang di-pin, SHA-256 diverifikasi saat startup | `src/circuitArtifacts.ts:44` (`verifyCircuitArtifacts`; pin di `:27` dan `:31`) |

## Menjalankan / Deploy

```bash
npm install
cp .env.example .env   # isi AGENT_GAMES_HMAC_SECRET dulu
npm run commitment     # generate salt + commitment, tulis .env.strategy
npm test               # 24 tes, semua harus lolos
npm run demo           # match 20 turn (tanpa Kurier kalau KURIER_API_KEY tidak diset)
npm run demo:defensive # demo defensive — FORTIFY + HOLD live (commitment terpisah)
npm run demo:refusal   # demo refusal
npm run demo:treasury  # treasury guard — spend 11 ditolak, spend 5 proved, di luar allowlist ditolak
npm run attack         # lima serangan, semua harus gagal
npm run verify:proof   # verifikasi satu proof asli tanpa kode repo (snarkjs saja)
npm run reveal:demo    # buka strategi DEMO dan hitung ulang commitment-nya
npm run build
npm start              # jalan di http://localhost:3000
```

Cek kesehatan: `curl http://localhost:3000/health`

Hasil terakhir (16 Nov 2026): **24 tes lolos, 0 gagal** — health, preflight bertanda tangan, penolakan signature salah/tanpa signature, turn valid (EXTRACT 10 + `publicInputsHash` yang cocok), replay `idempotencyKey` mengembalikan respons identik, key deterministik UUIDv5, FORTIFY/HOLD tanpa `amount`, deadline kedaluwarsa → HOLD, commitment hash tidak cocok → HOLD, aturan daftar keputusan circuit, 17 input ter-wire, params tidak valid ditolak, commitment cocok nilai golden dari probing circuit, proof EXTRACT/HOLD/FORTIFY yang prove + self-verify, aksi yang salah untuk state-nya **tidak bisa** dibuktikan (circuit assert menolak), GET /agent info pemakaian, GET /demo ringkasan, POST /verify menerima proof asli dan menolak yang dirusak, JSON store round-trip atomik dan tahan file corrupt, dan hash artefak circuit yang di-pin cocok dengan file di disk.

Waktu generate proof per turn (lokal): ~0,5–0,7 dtk steady-state (turn pertama ~1,3 dtk, cold start). Demo 20 turn: 20/20 proved + verified, total 12,6 dtk (rata-rata 630 mdtk/turn), skor akhir simulasi 168–28 (menang lawan opponent scripted).

Catatan: `npm test` memakai `--test-force-exit` karena snarkjs meninggalkan worker MessagePort terbuka setelah `fullProve`, sehingga proses Node tidak keluar sendiri. Ini hanya soal test runner — server produksi memang jalan terus.

**Deploy (Railway):** berbasis Dockerfile. Set Variables ini di Railway (isi nilai ASLI di Railway saja, jangan di chat): `AGENT_GAMES_HMAC_SECRET` (dari dashboard Agent Games), `KURIER_API_KEY` (API key mainnet Kurier), `STRATEGY_PARAMS` (`[10,0,0,0,0,0,0,0]`), `STRATEGY_SALT` (dari `.env.strategy`), `STRATEGY_COMMITMENT_HASH` (dari `.env.strategy` — `0x0b9f4672eb0b10bba098b648216126cb6256f43b0879833483b7f4631f61cb39` untuk params default + salt yang digenerate 14 Nov 2026), `CIRCUIT_VERSION=v1`, `PROOF_ENABLED=true`. Opsional: `IDEMPOTENCY_STORE_PATH` (mis. `/data/idempotency.json`) — hanya berguna di host dengan volume persisten; Railway tidak ada volume terpasang, jadi biarkan tidak diset di sana. Setelah ubah Variables, klik "Apply change" → Deploy — Railway tidak auto-deploy perubahan env var. Endpoint publik: `https://agent-games-steal-the-vfy-production.up.railway.app/agent` (daftarkan path handler lengkapnya).

## Batasan yang jujur

- **Turnamen Steal sudah terkunci** — entri ini adalah demo + proof untuk Wildcard, bukan peserta turnamen.
- **Strategi difiksasi oleh daftar keputusan circuit** — agent tidak bisa memakai strategi bebas (mis. reaksi terhadap riwayat lawan); yang bisa diubah hanya 8 angka `strategyParams`, dan setiap perubahan butuh commitment baru.
- **Params semua-nol tidak bisa dibuktikan** (`params[0]=0` melanggar assert range circuit).
- **Digest circuit** (`publicSignals[0]`) adalah nilai internal circuit, bukan `publicInputsHash` — input yang benar ⇒ digest yang benar; tidak ada yang perlu dilakukan.
- Idempotency disimpan di **Map in-memory** (`src/turn.ts`) secara default — hilang saat server restart/redeploy. Set `IDEMPOTENCY_STORE_PATH` (mis. `/data/idempotency.json` di host dengan volume) untuk mirror ke disk dengan atomic writes (`src/store.ts`). Railway tidak ada volume terpasang, jadi persistensi hanya berlaku di host dengan disk persisten.
- **Dockerfile sudah terbukti build di Railway** — deployment 14 Nov 2026 (552675ed) build dari Dockerfile ini dan berjalan.

## Keamanan

- Jangan pernah kirim seed phrase / private key / API key / HMAC secret / salt lewat chat atau ke model AI. Semua rahasia hanya lewat environment variables (`.env` / `.env.strategy` lokal, Variables Railway).
- Jangan commit `.env` / `.env.strategy`. Jangan log rahasia apa pun.
- Manual play dilarang aturan resmi: agent harus menjawab otomatis.
- Satu akun kompetisi per orang/tim, satu GitHub per akun kompetisi.

## Proof reference (submission Wildcard)

- Repo: https://github.com/JM-03/agent-games-steal-the-vfy
- Endpoint demo: `https://agent-games-steal-the-vfy-production.up.railway.app/agent`
- Circuit vk_hash: `0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047`
- Commitment (params `[10,0,0,0,0,0,0,0]`): `0x0b9f4672eb0b10bba098b648216126cb6256f43b0879833483b7f4631f61cb39`
- Kurier job id (satu proof dari demo, Finalized 17 Nov 2026): `2d523ed8-e255-11f1-838e-1e6a0d14f999`
