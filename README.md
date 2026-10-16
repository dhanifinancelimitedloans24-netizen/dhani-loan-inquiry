# Dhani Finance Loan Enquiry Website

Includes a responsive public enquiry form, email notification integration, and password-protected admin dashboard.

## Important setup notes
- The recipient email is set to `dhanifinancelimitedloans24@gmail.com`.
- Email is sent using SMTP credentials you configure in hosting. Do not put SMTP passwords in public code or commit `.env`.
- The admin password must be unique and at least 12 characters.
- This starter stores enquiries in a local JSON file. On hosting platforms with ephemeral filesystems, data can be lost on redeploy/restart. For reliable production use, connect a persistent database (for example, managed PostgreSQL) before collecting real customer information.
- Admin sessions are held in server memory and will be cleared on restart. Use a production session store before relying on this for business operations.
- This is an enquiry collection starter, not a lender approval system. Verify legal rights to use the brand and provide the operator's privacy notice, contact details, and applicable regulatory disclosures before going live.
- Do not collect Aadhaar, PAN, bank login details, or OTPs in this basic form.

## Run locally
1. Install Node.js 18 or newer.
2. Copy `.env.example` to `.env`.
3. Set a long unique `ADMIN_PASSWORD`, a random `SESSION_SECRET`, and valid SMTP settings.
4. Run `npm install`, then `npm start`.
5. Visit `http://localhost:3000`; admin login is at `http://localhost:3000/admin`.

## Gmail SMTP
For a Gmail sender account, enable 2-step verification and create an App Password. Use the sender account as `SMTP_USER` and the app password as `SMTP_PASS`. Never share your normal email password.

## Deploy to Render
1. Upload this project to a private GitHub repository.
2. In Render, create a new Web Service from that repository.
3. Render should detect `render.yaml`. If not, set Build Command to `npm install` and Start Command to `npm start`.
4. In Render Environment, set `ADMIN_PASSWORD`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, and `SMTP_PASS`. Set `EMAIL_TO` to `dhanifinancelimitedloans24@gmail.com`.
5. Deploy, open the public URL, and submit a test enquiry. Confirm that the email arrives before advertising the form.
6. Add a persistent database and persistent session store before production use; this starter's local JSON storage is not durable on ephemeral hosting.

## Environment variables
See `.env.example`. `SESSION_SECRET` is included for deployment readiness; the current in-memory session implementation uses random session tokens.
