# Skill Shelf

Katalog lokal skill dan agent yang terpasang, plus jumlah pemakaiannya dari riwayat sesi Claude Code.

```bash
node server.mjs          # http://127.0.0.1:5178
PORT=8080 node server.mjs
```

Tanpa dependency (Node ≥ 20). Data dibaca langsung tiap kali halaman dimuat atau tombol "Pindai ulang" ditekan.

## Sumber data

| Data | Lokasi |
|---|---|
| Skill bersama | `~/.agents/skills/` + `~/.agents/.skill-lock.json` |
| Skill khusus Claude | `~/.claude/skills/` (folder asli, bukan symlink) |
| Skill akun claude.ai | `~/.claude/skills/synced/*/` |
| Skill & agent plugin | `~/.claude/plugins/cache/` (plugin aktif di `settings.json`) |
| Agent pribadi | `~/.claude/agents/*.md` |
| Antigravity / OpenCode | `~/.gemini/config/skills/`, `~/.config/opencode/skills/` |
| Pemakaian | `~/.claude/projects/**/*.jsonl` (pemanggilan `Skill`, `Agent`, dan slash command) |

## Batasan

- Pemakaian hanya dari Claude Code. Antigravity dan OpenCode belum dihitung.
- Skill yang dimuat otomatis tanpa pemanggilan tool `Skill` tidak tercatat.
- Rank: S ≥ 10×, A ≥ 4×, B ≥ 1×, C belum pernah dipakai.
- Server hanya listen di `127.0.0.1`. Endpoint `/api/skill` hanya melayani file `SKILL.md` di folder skill.
