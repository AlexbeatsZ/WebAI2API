# Operations console

## Product and audience

The console is for an operator maintaining browser-backed AI connections. Its single job is to make health, capacity, login state, and recovery actions understandable without exposing internal adapter terminology.

## Direction

- Canvas `#081019`, raised surface `#101B27`, border `#223244`.
- Primary text `#EAF2F8`, secondary text `#91A4B7`.
- Healthy/active `#45D6C7`, warning `#F0B35A`, danger `#FF6B7A`.
- Display: system condensed sans where available; body: system UI; data: `ui-monospace`.
- Signature: a live topology rail that reads Browser connection -> Website -> Page slots and uses state, not decoration, as its visual rhythm.

The deliberately distinctive element is the topology rail. Cards, motion, gradients, and rounded corners stay restrained so the runtime structure remains the visual identity.

## Information architecture

Primary navigation is Overview, Connections, Requests, Live browser, and Settings. Logs and low-level diagnostics open in contextual drawers. UI copy names user-recognizable objects and actions: connection, website, parallel pages, sign in, restart. It never narrates implementation work or the prompt that led to a feature.

The diagnostics drawer shows aggregate capacity and queue state before recent logs. Operators may download the same sanitized snapshot exposed by the maintenance API. The snapshot is safe to attach to a repair task because it excludes cookies, credentials, browser storage, and message bodies.

The interface supports 390px width, visible keyboard focus, and reduced motion. When API authentication is disabled, the app skips the login modal and shows a persistent network exposure warning.
