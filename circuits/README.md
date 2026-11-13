# circuits/

File circuit **asli** untuk Steal the VFY, diunduh dari situs resmi
(`https://agentgames.zkverify.io/api/circuit-info`, 2026-11-13):

- `vfy-policy.wasm` — circuit WASM (2,9 MB)
  sha256: `bc0998250d2baf75b89deef5306867ffa7085a08d4f7d2caf0dd63a060b134d2`
- `vfy-policy_final.zkey` — proving key (792 KB)
  sha256: `f9666a1655279ef27f7fee6d535ac8aa9e39286ac40ff6279fea87c21ab6ce41`
- `circuit-info.json` — salinan respons `/api/circuit-info` saat diunduh.
  vk_hash vfy-policy:
  `0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047`

Jangan mengedit file-file ini. Kalau situs resmi memperbarui circuit,
unduh ulang dari URL di atas dan perbarui hash di file ini serta
`VK_HASH` di `.env.example`.

Catatan penting: nama-nama input signal circuit **tidak** tercantum di
file-file ini. Lihat `../CIRCUIT_NOTES.md` untuk 9 nama yang sudah
terbukti dan 8 nama yang masih hilang.
