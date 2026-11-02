# CESMII Smart Manufacturing Catalog — listing sheet

Fields follow what the Catalog shows on every entry (catalog.cesmii.net): name, vendor, description,
tags, SM imperative, category, asset link, vendor website, images. Image URLs below assume the repo is
public at the asset link; Jonathan links them from there.

| Field | Value |
|---|---|
| Name | i3X Failover Harness |
| Vendor | CivOps |
| Vendor website | https://civops.io |
| SM imperative | i3X |
| Category | Open Source |
| License | MIT |
| Asset link | https://github.com/Civops-Platform/i3x-failover-harness |
| Tags | #Redundancy #Failover #Conformance #Testing #HighAvailability #OpenSource |
| Hero image | `catalog/hero-1600x900.png` → https://raw.githubusercontent.com/Civops-Platform/i3x-failover-harness/main/catalog/hero-1600x900.png |
| Image source | `catalog/src/hero.html` (rendered by `catalog/render.sh`, headless Chrome at 1600×900) |
| Vendor logo | `catalog/civops-logo-light.png` (light backgrounds), `catalog/civops-logo-dark.png` (dark), 800×192; SVG sources in `catalog/src/` |

## Description (short — the line under the title)

Proves a redundant i3X server keeps working when one of its nodes dies, by killing a node on purpose, over and over, and checking what a client actually saw.

## Description (long)

Every vendor with a redundant pair says failover works. The usual evidence is a slide, or a demo where somebody stops a service politely and waits. This harness pulls the plug instead. Taking a node down is a command you supply (docker kill, systemctl kill, a call to a managed power strip, whatever your setup allows), and the harness only talks plain i3X 1.0 over HTTP, so it works against any vendor's server.

It has two modes. The first runs CESMII's own i3X 1.0 conformance suite against the surviving node while your command kills the other one partway through the run. Passing means a client on the survivor never noticed the takeover. The second is a drill: it keeps writing through whichever endpoint answers, each write with its own Idempotency-Key and retried on the next endpoint, kills the node holding the writes, and times how long a client waits before a write is acknowledged again. After all the cycles it reads the history back over i3X and checks that every acknowledged write is there exactly once, listing any lost or duplicated write by its key.

Against two nodes of the i3X Nexus server on synthetic data, 20 kills gave a worst-case write recovery of 10.6 seconds against a 30-second target, with 940 writes acknowledged, none lost and none duplicated. The conformance mode gave Full 1.0 Compliance, 53 passed and 0 failed, with the lease holder killed half a second into the run.

For the drill, the server needs a writable element that keeps every write in its history, and it has to honour Idempotency-Key, since i3X 1.0 requires neither. CESMII's suite is not bundled; the README says where to get it.

TypeScript on Node 22, MIT licensed, no runtime dependencies. Exit code 0 means pass, and every run writes a JSON report.
