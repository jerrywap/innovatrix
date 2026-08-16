Some pages needs to be updated
- http://127.0.0.1:3000/services
- http://127.0.0.1:3000/pricing
- http://127.0.0.1:3000/terms
- http://127.0.0.1:3000/privacy
- http://127.0.0.1:3000/concepts

- Hero page: Search 148 products, or describe what you need is just stub, it does not funciton.
- http://127.0.0.1:3000/custom-software non logged in user, is not able to chat (No such conversation. Fill in a form instead.)
- Login page should enable google signing.
- Configure email credentials in .env using smtp credentials.
- Pay by card Currency not supported by merchant (but i have paystack)
- After checkout by bank.. it takes user to http://127.0.0.1:3000/dashboard/software but this page shows Nothing here yet Software you buy shows up here, with your licence keys, downloads and updates. Since this is still a pending order, it should take user to ordes
- http://127.0.0.1:3000/dashboard/orders/ORD-2026-0007 takes user to 404 page.

src/app/(public)/custom-software/page.tsx > only 4 messages are there, I need random about 100 items that will show random 4 at a time.

- http://localhost:3000/staff (If i am logged in as admin I should see a link to /admin on my sidebar) and vise versa
- If i visit http://127.0.0.1:3000/dashboard/requests/REQ-2026-0001 as a user.
  - Under what happened it shows only date no time (in fact most of the places in the user dashboard it shows only date not time)
- at what point is this page relevant? http://127.0.0.1:3000/dashboard/messages 
- this screen http://127.0.0.1:3000/dashboard/organization does not seem to be relevant yet.
- http://localhost:3000/staff/requests/REQ-2026-0002 (I dont undrstand how this workflow is) 
  - I expectd at a point for the work to start and user should be able to track progress as staff people update the timeline.
- http://localhost:3000/admin/dashboard (expected - analytics dashboard)
- http://localhost:3000/staff/dashboard (expected - analytics dashboard)
- http://localhost:3000/admin/settings/payments currency routing section..
