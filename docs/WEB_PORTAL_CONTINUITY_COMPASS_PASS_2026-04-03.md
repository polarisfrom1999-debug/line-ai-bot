# WEB Portal Continuity / Compass Pass (2026-04-03)

## Added
- Home: 「相談の土台」 card
- Home: 「前回からつながる話題」 chips
- Chat: 「相談の土台」 card
- Chat: 「前回からつながる話題」 chips

## Intent
- Make deep consultation easier to resume from recent LINE/WEB context
- Surface the user's goal / recent concern / body-flow / ongoing continuity without forcing them to explain everything again
- Improve long-term retention by turning WEB into a reassuring place to return to

## Implementation
- Added `buildSupportCompass()` in `services/web_portal_data_service.js`
- Added `buildResumePrompts()` in `services/web_portal_data_service.js`
- Included those payloads in `getHomeData`, `getChatBundle`, `getRecordsBundle`, `getBootstrapData`
- Included `supportCompass` / `resumePrompts` in `/api/web/chat/send` response
- Rendered new cards in `public/web/index.html`, `public/web/app.css`, `public/web/app.js`
