# dsh-image-studio

Native visual tools for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`):
AI image generation and exact function plotting, presented ChatGPT-style in the Web UI.

An out-of-tree cordis bundle plugin with a browser client module — zero runtime dependencies,
no harness source changes.

## Tools

| Tool | Engine | Use |
|---|---|---|
| `generate_image` | DashScope `qwen-image-3.0-pro` (async task API) | conceptual illustrations, structure sketches, scenes, posters |
| `plot_function` | in-process sampler + pure-JS PNG encoder | exact math curves: calculus visualizations, function graphs (diffusion models cannot render accurate axes) |

Both tools save the PNG under `dsh-images/` in the session workspace, commit it through the
`attachments` seam, and hand the model a copy-ready markdown line so the image renders inline
in the assistant message.

## Web client module (`client.js`)

Loaded at boot via the `dsh.client` declaration (`platform: web`, `immediately`):

- message images re-laid out as a **3-per-row grid** of 4:3 cover tiles (inline styles, no
  dependence on hashed CSS-module class names);
- clicking any image opens a **fullscreen lightbox**: prev/next across the conversation,
  1:1 pixel zoom, download, Esc / arrow keys.

## Install

In the harness repo root (source run: `pnpm dsh ...`, installed: `dsh ...`):

```sh
dsh plugin --profile web add github:JayLi52/dsh-image-studio
```

## Configuration

`generate_image` reads `DASHSCOPE_API_KEY` from the launching environment
(`$DSH_HOME/.env` works). `plot_function` needs nothing.

Optional static serving for inline markdown images (private tunnel only):

```sh
node imgsrv.js   # serves the workspace root on 127.0.0.1:3081
```

## Expression support (plot_function)

`+ - * / ^ ( )`, `sin cos tan asin acos atan sinh cosh tanh sqrt abs exp ln log log2 log10
floor ceil round min max pow`, constants `pi` and `e`. `log` means log10, `ln` natural log.
Discontinuities (e.g. `tan`) break the curve instead of drawing vertical artifacts; the y
range auto-scales with outlier clipping unless `y_min`/`y_max` are given.

## Proactive-invocation guidance

The bundle injects a system-prompt section: when an explanation involves shape, structure or
space, the agent produces a visual on its own — `plot_function` for exact math,
`generate_image` for conceptual pictures — and embeds the result inline in its reply.

## Deploy on a fresh machine

The repo is the whole environment (hosts rotate; the repo does not):

```sh
git clone https://github.com/JayLi52/dsh-image-studio
cd dsh-image-studio
DASHSCOPE_API_KEY=... DOUBAO_SEARCH_API_KEY=... TOKEN_PLAN_DASHSCOPE_API_KEY=... \
  bash deploy/bootstrap.sh
```

`bootstrap.sh` installs `dsh` + pnpm, writes `~/.dsh/.env` and `settings.yaml`, adds both
plugins (this one and `dsh-web-search-doubao`), and installs two systemd units: `dsh-web`
(loopback :3080) and `dsh-images` (loopback :3081 static server for inline markdown images).
From your laptop:

```sh
ssh -f -N -L 3080:127.0.0.1:3080 -L 3081:127.0.0.1:3081 root@<host>
```

Browse http://127.0.0.1:3080; the first-visit trust URL (`?token=...`) is printed by
`journalctl -u dsh-web`. On each new host, register its fresh SSH public key as a repo
deploy key (Settings → Deploy keys) so the box can push its own iterations.
