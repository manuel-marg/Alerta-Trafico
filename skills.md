# 🛠️ Project Skills Index: Alerta-Tráfico

> **Catalogue of Specialized Procedural Workflows (`SKILL.md`)**  
> *Usage: Load on-demand when performing targeted operations.*

---

## Available Skills

| Skill | Location | Scope & Purpose |
| :--- | :--- | :--- |
| **`deploy-android-termux`** | [`skills/deploy-android-termux/SKILL.md`](file:///c:/Node.js/Alerta-Trafico/skills/deploy-android-termux/SKILL.md) | Deployment, Git sync, Termux SSH execution on port 8022, `nohup`, wake-lock, and Cloudflare tunnel management. |
| **`traffic-engine-optimization`** | [`skills/traffic-engine-optimization/SKILL.md`](file:///c:/Node.js/Alerta-Trafico/skills/traffic-engine-optimization/SKILL.md) | Traffic APIs (Google Routes API `computeRoutes`, Distance Matrix fallback, Mapbox integration) and adaptive polling quotas. |

---

## How to Author New Skills
1. Create a subfolder inside `skills/<skill-name>/`.
2. Add a `SKILL.md` file with YAML frontmatter:
   ```yaml
   ---
   name: <skill-name>
   description: Brief description of when and how the AI agent should use this skill.
   ---
   ```
3. Document the step-by-step procedures, edge cases, and verification scripts.
4. Add the entry to this `skills.md` index.
