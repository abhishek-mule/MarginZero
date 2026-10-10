# Product Requirements Document (PRD)
## Inverse Button Control System

**Version:** 1.0  
**Date:** 10 October 2026  
**Status:** Draft  
**Owner:** [Project Owner]  
**Document Type:** Technical + Product Requirements

---

## 1. Project Overview

### 1.1 Project Name
**Inverse Button Control System** (working title: *InverseClick*)

### 1.2 One-Line Summary
A cross-device system that allows a user to press Red/Green buttons on a mobile web app, which then triggers the **opposite** Red/Green button on a third-party website running in Chrome on a laptop — without any API access to the target website.

### 1.3 Problem Statement
A challenge was given: create a clone/control experience of a friend’s website that has Loss/Profit and Red/Green buttons. The requirement is that pressing a button on the user’s own mobile interface must execute the **inverse** action (Red → Green, Green → Red) on the friend’s live website open on the user’s laptop.

The friend’s website has:
- No public API
- No webhook support
- No official remote-control feature

Therefore a pure client-side + local-network solution is required.

### 1.4 Solution Summary
- Mobile web page (user’s control interface) sends a command over the local Wi-Fi network.
- A lightweight Node.js server running on the laptop receives the command.
- A Chrome Extension (content script) continuously polls the local server.
- When a command arrives, the content script finds the opposite-colored button on the friend’s website DOM and programmatically clicks it.

---

## 2. Goals & Objectives

### 2.1 Primary Goals
1. Pressing **Red** on mobile → clicks **Green** button on friend’s website.
2. Pressing **Green** on mobile → clicks **Red** button on friend’s website.
3. Works without any modification or API access to the friend’s website.
4. Works reliably on the same local Wi-Fi network.

### 2.2 Secondary Goals
- Extremely low latency (< 1 second from press to click).
- Simple enough to set up in under 15 minutes.
- Easy to adapt selectors when the target website’s DOM changes.
- Clean, documentable architecture suitable for a resume / portfolio project.

### 2.3 Non-Goals (Out of Scope for v1.0)
- Remote control over the internet (different networks).
- Support for multiple simultaneous users.
- Automatic detection of button selectors (manual configuration is acceptable).
- Mobile native app (web page is sufficient).
- Handling of complex authentication flows or CAPTCHA on the target site.

---

## 3. Users & Personas

| Persona | Description | Needs |
|---------|-------------|-------|
| **Controller (You)** | Person operating the mobile interface | Fast, reliable inverse clicks |
| **Observer / Friend** | Owner of the target website | Has given permission for the challenge |
| **Developer** | Person implementing & maintaining the system | Clear code, easy selector updates |

---

## 4. User Stories

1. **As a Controller**, I want to open a simple mobile web page with two large Red and Green buttons so that I can trigger inverse actions with one tap.
2. **As a Controller**, when I tap Red on my phone, I want the Green button on the friend’s website (open on my laptop) to be clicked automatically.
3. **As a Controller**, when I tap Green on my phone, I want the Red button on the friend’s website to be clicked automatically.
4. **As a Developer**, I want the button-finding logic to be isolated in one file so that I can update CSS selectors when the target site changes.
5. **As a Developer**, I want the system to work with zero external cloud services (pure local network) for maximum simplicity and privacy.

---

## 5. Functional Requirements

### 5.1 Mobile Control Interface
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01 | Display two large, clearly labeled buttons: **RED** and **GREEN** | Must |
| FR-02 | On button press, send an HTTP POST request containing the button name (`"red"` or `"green"`) to the local server | Must |
| FR-03 | Show visual feedback (brief color change or toast) that the command was sent | Should |
| FR-04 | Handle network errors gracefully (show alert if server unreachable) | Must |
| FR-05 | Be fully responsive and usable on mobile browsers | Must |

### 5.2 Local Server
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-06 | Accept POST `/command` with JSON body `{ "button": "red" | "green" }` | Must |
| FR-07 | Store the latest command in memory | Must |
| FR-08 | Expose GET `/command` that returns the pending command and then clears it | Must |
| FR-09 | Listen on `0.0.0.0:3000` so mobile devices on the same network can reach it | Must |
| FR-10 | Enable CORS so browser requests from the mobile page are allowed | Must |
| FR-11 | Log every received command to the console for debugging | Should |

### 5.3 Chrome Extension
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-12 | Background service worker polls `http://localhost:3000/command` every 500 ms | Must |
| FR-13 | When a command is received, forward it to the active tab’s content script | Must |
| FR-14 | Content script receives the command and clicks the **opposite** button | Must |
| FR-15 | Content script must be able to locate Red and Green buttons on the target page using configurable selectors / text matching | Must |
| FR-16 | Extension works on any website (host_permissions: `<all_urls>`) | Must |
| FR-17 | No persistent storage of commands beyond the current session | Should |

### 5.4 Inverse Logic
| Received from Mobile | Action on Target Website |
|----------------------|--------------------------|
| `"red"`              | Click the **Green** button |
| `"green"`            | Click the **Red** button   |

---

## 6. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Performance** | End-to-end latency (mobile press → target click) ≤ 800 ms under normal conditions |
| **Reliability** | System should recover automatically if the server is restarted |
| **Security** | Only reachable on local network; no authentication required for v1 (trusted environment) |
| **Compatibility** | Chrome (latest 2 major versions), modern mobile browsers (Chrome, Safari, Firefox) |
| **Maintainability** | Button selectors isolated in a single function for easy updates |
| **Simplicity** | Entire system installable and runnable by a developer in < 15 minutes |

---

## 7. System Architecture

```
┌─────────────────────┐         HTTP POST          ┌──────────────────────┐
│  Mobile Web Page    │ ─────────────────────────► │  Node.js Server      │
│  (Red / Green btns) │     { button: "red" }      │  (port 3000)         │
└─────────────────────┘                            │  Stores lastCommand  │
                                                   └──────────┬───────────┘
                                                              │
                                                              │ HTTP GET (poll every 500ms)
                                                              ▼
                                                   ┌──────────────────────┐
                                                   │  Chrome Extension    │
                                                   │  Background SW       │
                                                   └──────────┬───────────┘
                                                              │
                                                              │ chrome.tabs.sendMessage
                                                              ▼
                                                   ┌──────────────────────┐
                                                   │  Content Script      │
                                                   │  (on friend's site)  │
                                                   │  Finds opposite btn  │
                                                   │  → element.click()   │
                                                   └──────────────────────┘
```

### 7.1 Components

1. **Mobile Web Page** – Static HTML + vanilla JS  
2. **Local Server** – Express.js (Node.js)  
3. **Chrome Extension**
   - `manifest.json` (Manifest V3)
   - `background.js` (service worker – polling)
   - `content.js` (DOM interaction + inverse click)

---

## 8. Detailed Component Specifications

### 8.1 Mobile Web Page
- Two full-width or large centered buttons.
- Color coding:
  - Red button → background `#e74c3c`
  - Green button → background `#27ae60`
- On click → `fetch(SERVER + '/command', { method: 'POST', body: JSON.stringify({ button }) })`
- Server URL must be configurable (hard-coded IP for v1 is acceptable).

### 8.2 Server API

| Method | Endpoint   | Body / Response                          | Description                  |
|--------|------------|------------------------------------------|------------------------------|
| POST   | `/command` | `{ "button": "red" \| "green" }`         | Accepts new command          |
| GET    | `/command` | `{ "button": "red" \| "green" \| null }` | Returns & clears last command|

### 8.3 Content Script – Button Discovery Strategy

The content script shall attempt to locate buttons using multiple strategies (in order of preference):

1. CSS class names containing `red`, `green`, `loss`, `profit`
2. Button / element text content containing “Red”, “Green”, “Loss”, “Profit”
3. Inline style `background-color` matching red/green hues
4. Data attributes if present (`data-color`, `data-action`, etc.)

The mapping logic must remain:
- Incoming `"red"` → click the element identified as Green
- Incoming `"green"` → click the element identified as Red

---

## 9. Technical Constraints & Assumptions

### Assumptions
- Both devices (phone + laptop) are on the **same Wi-Fi network**.
- The target website is open in a Chrome tab on the laptop.
- The Chrome Extension is installed and enabled.
- The user has permission from the website owner (challenge context).
- Target buttons are present in the DOM (not inside Shadow DOM or iframes that block access).

### Constraints
- No modification of the friend’s website source code.
- No cloud services (Firebase, Pusher, etc.) for v1.
- Must work offline from the public internet (local network only).

---

## 10. Success Criteria

| Metric | Target |
|--------|--------|
| Correct inverse mapping | 100% of presses result in opposite button click |
| Latency | ≤ 800 ms average |
| Setup time for a new developer | ≤ 15 minutes |
| Selector update time when site changes | ≤ 5 minutes |

---

## 11. Future Enhancements (Post v1.0)

| Priority | Enhancement |
|----------|-------------|
| High | WebSocket instead of polling (lower latency + less load) |
| High | Remote access via ngrok / Cloudflare Tunnel |
| Medium | Visual overlay on target page showing “Controlled by InverseClick” |
| Medium | Support for more than two buttons / custom mappings |
| Low | Electron desktop companion instead of Chrome Extension |
| Low | Automatic selector learning via visual highlighting |

---

## 12. File Structure (Recommended)

```
inverse-control/
├── server/
│   ├── package.json
│   └── server.js
├── extension/
│   ├── manifest.json
│   ├── background.js
│   └── content.js
├── mobile/
│   └── index.html
└── docs/
    └── prd.md          ← this document
```

---

## 13. Open Questions / Risks

| Risk | Mitigation |
|------|------------|
| Target site uses Shadow DOM or heavy iframe isolation | Manual selector testing; may need `chrome.scripting.executeScript` with deeper access |
| Buttons are re-rendered frequently (SPA) | Content script should re-query DOM on every command |
| Laptop firewall blocks port 3000 | Document how to allow the port |
| Mobile browser blocks mixed-content or CORS | Server must set proper CORS headers (already planned) |

---

## 14. Approval

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Product Owner | | | |
| Developer | | | |
| Reviewer | | | |

---

**End of Document**
