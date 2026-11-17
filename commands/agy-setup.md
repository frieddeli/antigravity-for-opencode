---
description: Verify the Antigravity (agy) CLI is installed and authenticated and the OpenCode plugin is ready to use.
---

Run the plugin's doctor (`agy_doctor` tool or `agy-doctor` in `shell`) and report status.

Then summarize for the user:
- Is `agy` installed, and can it list models (i.e. authenticated)?
- Are the plugin scripts executable and is `@opencode/plugin` installed?
- What GCP project / region / default tier models is `agy` configured for?

If anything is missing or failing, give the **exact** command to fix it (install agy,
authenticate, `chmod +x` the scripts, etc.). Keep it short and actionable.
