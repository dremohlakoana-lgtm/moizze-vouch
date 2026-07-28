# 🏦 Moizze — Vouch Banking App

A full-stack digital banking app powered by **Vouch** — a virtual currency system that eliminates the need for a banking license.

## ✨ Features

- 💰 **Vouch Wallet** — Send, receive, and manage Vouch balance
- 💳 **Buy Vouch** — Purchase Vouch with real money via Paystack
- 🏧 **Withdraw** — Convert Vouch back to cash (admin approved)
- 📊 **Transaction History** — Full paginated history
- 👤 **User Profiles** — Unique 10-digit account numbers
- 🔐 **Secure Auth** — JWT + bcrypt encryption
- 👨‍💼 **Admin Dashboard** — Manage users, load vouch, approve withdrawals

## 🛠 Tech Stack

- **Backend:** Node.js + Express
- **Database:** PostgreSQL
- **Auth:** JWT + bcrypt
- **Payments:** Paystack
- **Frontend:** HTML/CSS/JavaScript
- **Deploy:** Render

## 🚀 Deploy on Render

1. Fork this repo
2. Go to [render.com](https://render.com) → New → Blueprint
3. Connect this repo — Render reads `render.yaml` automatically
4. Add environment variables: `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`
5. Deploy!

## ⚙️ Environment Variables

See `.env.example` for required variables.

## 👑 Admin Access

Register with the email set in `ADMIN_EMAIL` env var (default: `admin@moizze.com`) to get admin role.

---

Built with ❤️ by Moizze
