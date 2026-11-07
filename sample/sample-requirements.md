# Product Requirements: FreshCart Grocery Delivery (MVP)

## Overview
FreshCart is a mobile-first web app that lets customers in Metro Manila order groceries from partner
supermarkets and get them delivered within 2 hours. The MVP targets launch in Q1.

## Users
- Customer: browses products, places orders, pays, tracks delivery.
- Store admin: manages product catalogue, stock and order fulfilment for one store.

## Requirements

### 1. Account
- Customers sign up with email + password or Google. Email must be verified before first checkout.
- Customers can reset a forgotten password via an emailed link that expires after 30 minutes.
- Customers can save up to 5 delivery addresses and mark one as default.

### 2. Catalogue & search
- Products are shown by category with image, name, price (PHP) and stock status.
- Search by product name with results in under 1 second for 95% of queries.
- Out-of-stock items are visible but cannot be added to the cart.

### 3. Cart & checkout
- Cart keeps items for 7 days for logged-in users.
- Minimum order is PHP 500. Delivery fee is PHP 79, free above PHP 2,000.
- Payment by GCash, credit/debit card, or cash on delivery (COD only for orders under PHP 5,000).
- Customers choose a 1-hour delivery slot from the next 48 hours.

### 4. Order tracking
- Customers see order status: Placed, Picking, Out for delivery, Delivered, Cancelled.
- Customers get an SMS and email at each status change.
- Customers can cancel an order until it moves to Picking.

### 5. Store admin
- Admins can add/edit products, set price and stock, and upload images (max 5 MB, JPG/PNG).
- Admins see incoming orders in real time and move them through the statuses.
- Admins can mark an item as unavailable during picking; the customer is refunded for that item.

## Non-functional
- Works on the latest two versions of Chrome, Safari and Firefox, and on screens from 360px wide.
- WCAG 2.1 AA accessibility.
- Personal data handled in line with the Philippine Data Privacy Act.
