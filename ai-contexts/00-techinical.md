I’ve updated the architecture so the system is now centered around the four real operating flows you described: **marketplace purchase, marketplace customization, custom build, and customer-service fulfillment**. I’ve also added the missing layers around carts, previews, AI-assisted requirements gathering, script configuration, demo credentials, delivery access, internal handoff, ticketing, and post-purchase lifecycle.

# Innovatrix

## High-Level Product & Technical Architecture

**Primary Framework:** Next.js
**Document Purpose:** Product definition, system architecture, workflow specification, domain boundaries, implementation direction, and engineering context for AI-assisted development.

---

# 1. Product Overview

Innovatrix is an integrated software marketplace, custom software development platform, technical services platform, and post-delivery customer management system.

The platform should not be designed as a traditional code marketplace where customers simply purchase files.

Innovatrix should support customers across the complete software acquisition and delivery lifecycle:

```text
Discover
→ Evaluate
→ Purchase or Request
→ Clarify Requirements
→ Pay
→ Deliver
→ Configure
→ Customize
→ Test
→ Support
→ Maintain
→ Improve
```

The primary business proposition is:

> **Innovatrix helps customers find, customize, build, deploy and maintain software.**

Customers may arrive with very different levels of technical knowledge.

Some customers know exactly what they want:

> "I need a Laravel CRM script."

Others know only the business outcome:

> "I need software to manage my cleaning company."

The platform must provide a good experience for both.

---

# 2. Core Product Paths

There are four primary operational paths.

```text
                        INNOVATRIX

       ┌────────────────────┼────────────────────┐
       │                    │                    │
       ▼                    ▼                    ▼

 MARKETPLACE             CUSTOM BUILD         TECHNICAL HELP

       │                    │                    │
       ▼                    ▼                    ▼

 Buy As-Is           AI Guided Request      Support / Setup
 Request Changes     Requirements           Maintenance
 Installation        Quote / Review         DevOps
 Configuration       Development            Tech Assistant

       └────────────────────┼────────────────────┘
                            │
                            ▼
                     CUSTOMER PORTAL
                            │
                            ▼
                    SUPPORT & DELIVERY
```

Supporting these customer journeys is an internal Innovatrix staff environment for:

* Requirement management
* Customer communication
* Ticketing
* Product management
* Customization management
* Projects
* Deployment
* Testing
* Billing
* Support
* Follow-up

---

# 3. Product Philosophy

The platform should answer five questions for every customer:

1. What do you need?
2. What does Innovatrix already have that can help?
3. What will it cost?
4. What is happening with your request or purchase?
5. What can you do next?

The system should progressively simplify complexity.

A non-technical customer should never need to understand:

* frameworks
* database engines
* deployment architecture
* APIs
* infrastructure terminology

unless those details are relevant to them.

Innovatrix should translate business requirements into technical implementation internally.

---

# 4. Main Application Surfaces

The application should contain four major user-facing areas.

## 4.1 Public Website

Primarily used for:

* Company positioning
* Service discovery
* Marketplace discovery
* Product browsing
* Custom software requests
* Technical assistance requests
* Authentication

---

## 4.2 Customer Portal

Used after login for:

* Purchases
* Downloads
* Software access
* Customization requests
* Projects
* Tickets
* Messages
* Testing
* Approvals
* Payments
* Support
* Maintenance
* Renewals

---

## 4.3 Customer Service / Operations Portal

Used by Innovatrix staff responsible for:

* Customer follow-up
* Requirement clarification
* Ticket management
* Assignment
* Communication
* Quote preparation
* Escalation
* Customer success
* Tracking outstanding customer actions

---

## 4.4 Administrative / Technical Portal

Used for:

* Marketplace products
* Script uploads
* Product configuration
* Demo environments
* Product versions
* Downloads
* Licensing
* Developers
* Projects
* Infrastructure
* Billing
* Security
* System configuration

These may initially exist within the same Next.js application while maintaining strict authorization boundaries.

---

# 5. Core Workflow 1 — Existing Marketplace Product

The first major workflow is a customer purchasing an already-existing software product.

```text
Landing
↓
Marketplace
↓
Browse / Search / Filter
↓
Product Page
↓
Preview / Demo / Documentation
↓
Choose Purchase Path

 ┌──────────────────┴──────────────────┐
 ▼                                     ▼

Buy As-Is                      Request Modification

 ▼                                     ▼

Add to Cart                     AI Customization Assistant
 ▼                                     ▼
Review Cart                     Requirements Summary
 ▼                                     ▼
Checkout                        Staff Review / Quote
 ▼                                     ▼
Payment                         Approval / Payment
 ▼                                     ▼
Dashboard                       Customization Work
 ▼                                     ▼
Software Access                 Testing
 ▼                                     ▼
Download / Setup                Delivery
```

---

# 6. Marketplace Experience

The marketplace should provide a complete modern digital marketplace experience.

Core capabilities should include:

* Search
* Category browsing
* Industry browsing
* Technology filtering
* Price filtering
* Popular products
* Latest products
* Featured products
* Recommended products
* Recently viewed products
* Product comparison
* Favourites / saved products
* Product screenshots
* Product videos
* Product demos
* Documentation
* Feature lists
* System requirements
* Technology information
* Version information
* Changelog
* Support availability
* Installation options
* Customization availability
* Ratings/reviews if introduced
* Related products

The marketplace should be optimized for both technical and non-technical customers.

---

# 7. Marketplace Categories

Potential product types:

* Complete Applications
* SaaS Applications
* Web Applications
* Mobile Applications
* Scripts
* Dashboards
* Admin Panels
* Templates
* Starter Kits
* Plugins
* Components
* Automation Tools
* APIs
* Integrations
* Developer Tools

Products may also belong to industries:

* Healthcare
* Education
* Logistics
* Hospitality
* Property
* Finance
* E-commerce
* HR
* CRM
* Booking
* Inventory
* Professional Services
* Nonprofit
* Retail
* Other

---

# 8. Product Detail Experience

Every product should have a rich product page.

Conceptually:

```text
Product

├── Name
├── Summary
├── Full Description
├── Price
├── Screenshots
├── Video
├── Live Demo
├── Admin Demo
├── Features
├── Technology
├── Requirements
├── Installation Information
├── Version
├── Changelog
├── Documentation
├── Support
├── Licence
├── Add-ons
├── Customization Availability
└── Related Products
```

Primary actions:

```text
Buy As-Is

Request Customization

Try Demo

Save for Later
```

---

# 9. Product Demo & Testing Credentials

Marketplace administrators should be able to configure demo access for products.

A product may support:

* Public demo URL
* Customer demo URL
* Admin demo URL
* Test credentials
* Multiple user-role credentials
* Demo instructions
* Temporary sandbox
* Reset schedule

Example:

```text
Live Demo

Customer Portal:
URL: demo.example.com
Email: customer@example.com
Password: ********

Admin Portal:
URL: demo.example.com/admin
Email: admin@example.com
Password: ********
```

Credentials should be stored securely and only exposed according to product configuration.

Sensitive production credentials must never be stored as product demo credentials.

---

# 10. Dynamic Sandbox Environments

Some products may require temporary isolated demos rather than shared credentials.

Example:

```text
Try Product
↓
Create Sandbox
↓
Provisioning
↓
Temporary Environment Created
↓
Customer Receives Credentials
↓
Customer Tests Product
↓
Session Expires
↓
Environment Destroyed
```

Sandbox states:

```text
Requested
Provisioning
Ready
Failed
Expired
Destroying
Destroyed
```

Sandbox operations should run asynchronously.

---

# 11. Buy As-Is Workflow

If a customer wants the existing product without changes:

```text
Product
↓
Select Licence / Package
↓
Optional Add-ons
↓
Add to Cart
↓
Cart Review
↓
Checkout
↓
Payment
↓
Order Confirmation
↓
Licence / Entitlement Created
↓
Product Added to My Software
↓
Download / Access Links Available
```

Optional add-ons may include:

* Installation
* Setup
* Deployment
* Branding
* Hosting setup
* Payment integration
* Data import
* Maintenance
* Priority support

---

# 12. Shopping Cart

The cart should support mixed digital/service purchases where commercially appropriate.

Example:

```text
CRM Pro                       £299

Installation                  £99

Brand Setup                   £49

1 Year Support                £149
---------------------------------
Total                         £596
```

Cart capabilities:

* Add item
* Remove item
* Quantity where relevant
* Licence selection
* Service add-ons
* Discount codes
* Taxes
* Currency
* Save cart
* Cart expiry if required

---

# 13. Checkout

Checkout should be simple and optimized for conversion.

Potential steps:

```text
Cart
↓
Account / Login
↓
Billing Information
↓
Order Review
↓
Payment
↓
Confirmation
```

Avoid unnecessary multi-step complexity.

Payment verification must happen server-side.

A frontend payment success redirect must never be treated as authoritative payment confirmation.

---

# 14. Post-Purchase Access

After successful purchase, the customer should immediately receive access through their dashboard.

Example:

```text
My Software
└── CRM Pro
    ├── Download
    ├── Licence
    ├── Documentation
    ├── Version
    ├── Updates
    ├── Installation Service
    ├── Request Customization
    ├── Request Support
    └── Maintenance
```

This becomes the long-term relationship between the customer and their purchased software.

---

# 15. Core Workflow 1B — Request Modification Before Purchase

A customer viewing an existing product should be able to say:

> "This is almost what I need, but I want some changes."

This should launch an AI-assisted customization workflow.

The customer should not be shown a complex technical requirements form.

---

# 16. AI-Assisted Customization Workflow

The AI assistant should behave like a friendly requirements analyst.

It should progressively determine:

* what the customer likes about the existing product
* what they want changed
* what they want removed
* what they want added
* branding requirements
* workflow changes
* integrations
* user roles
* reporting requirements
* deployment needs
* expected timeline
* budget range where relevant

The interaction should resemble a conversation.

Example:

```text
AI:
What would you like to change about CRM Pro?

Customer:
I want it for a property agency.

AI:
No problem. Are you mainly looking to change the branding,
or should the system also handle property listings,
landlords and tenants?

Customer:
Listings, landlords, tenants and rent reminders.

AI:
Understood. I can help structure that.

Would your tenants need their own login,
or would only your staff use the system?
```

The system should ask questions dynamically rather than presenting 40 fields at once.

---

# 17. AI Assistant Principles

The AI requirement assistant should:

* use simple language
* avoid unnecessary jargon
* ask one logical question at a time
* adapt based on previous answers
* allow free-form responses
* suggest common options
* identify unclear requirements
* summarize understanding
* allow users to edit the summary
* never fabricate agreed requirements
* differentiate assumptions from confirmed requirements

The AI is an assistant.

It does not independently approve pricing, contracts, deadlines or technical feasibility.

---

# 18. AI Requirements Output

At the end of the customization conversation, the customer should see a structured summary.

Example:

```text
Your Customization Request

Base Product:
CRM Pro

Business Type:
Property Management

Requested Changes:

✓ Add properties
✓ Add landlords
✓ Add tenants
✓ Rent reminder notifications
✓ Tenant login
✓ Company branding
✓ Custom dashboard

Possible Integration:
Stripe payments

Deployment:
Customer needs hosting assistance

Timeline:
Within 4 weeks

Additional Notes:
Customer currently manages approximately 150 properties.
```

Customer actions:

```text
Edit Request
Continue Conversation
Submit to Innovatrix
```

---

# 19. Customization Submission

Once submitted:

```text
AI Conversation
↓
Structured Requirements
↓
Customization Request Created
↓
Customer Dashboard
↓
Innovatrix Customer Service Queue
↓
Technical Review
↓
Clarification if Required
↓
Quote
↓
Customer Approval
↓
Payment
↓
Work Begins
```

The complete AI conversation should remain available to authorized Innovatrix staff.

The structured requirements summary should become the primary operational representation.

---

# 20. Customization Relationship to Marketplace Product

Customization should retain an explicit relationship with the original product.

Example:

```text
Customization Request

Base Product:
CRM Pro v2.4

Customer:
ABC Property Ltd

Changes:
7

Status:
Under Technical Review
```

This makes future upgrades, maintenance and support easier to understand.

---

# 21. Core Workflow 2 — Custom Software Build

Customers who do not want an existing marketplace product can start from their business requirement.

The custom build journey should also be AI-assisted.

```text
Landing
↓
Build Custom Software
↓
AI Requirements Assistant
↓
Business Need Discovery
↓
Feature Suggestions
↓
Requirements Summary
↓
Customer Review
↓
Submit
↓
Account / Dashboard
↓
Customer Service Review
↓
Technical Review
↓
Quote
↓
Approval
↓
Payment
↓
Project
```

---

# 22. Custom Build AI Assistant

The assistant should first understand the problem, not the technology.

Questions could include:

> What are you trying to achieve?

> Who will use the software?

> What do you currently use?

> What problems are you experiencing?

> What should users be able to do?

> Will customers use the system directly?

> Do you need payments?

> Do you need reports?

> Does this need to work on mobile?

> Do you already have a website or software?

From the answers, the assistant can suggest functionality.

---

# 23. AI Feature Suggestions

The assistant may suggest useful features based on the customer's business context.

Example:

Customer:

> I want a platform for managing a care agency.

AI may suggest:

```text
You may find these useful:

[✓] Staff Profiles

[✓] Shift Scheduling

[✓] Client Records

[ ] Timesheets

[ ] Payroll Integration

[ ] Staff Mobile Access

[ ] Notifications

[ ] Reporting Dashboard
```

The customer can:

* accept
* reject
* ask questions
* add their own features

Suggestions should never silently become requirements.

---

# 24. Existing Product Recommendations During Custom Build

One powerful Innovatrix capability should be detecting when the marketplace may already contain something suitable.

Example:

Customer describes:

> Appointment booking platform.

AI may respond:

```text
Innovatrix already has two products that may provide
most of what you need.

Would you like to:

[View Existing Solutions]

[Continue With Custom Build]
```

This prevents unnecessary development and can reduce customer cost and delivery time.

The AI should not force the marketplace option.

---

# 25. Custom Build Submission

At completion:

```text
Requirements Conversation
↓
Structured Project Brief
↓
Submit
↓
Request Reference Generated
↓
Dashboard Access
↓
Customer Service Queue
```

The customer can then track progress from their dashboard.

---

# 26. Request References

All business interactions should use human-friendly reference numbers.

Examples:

```text
REQ-2026-0148

CUS-2026-0084

PRJ-2026-0051

CHG-2026-0104

TKT-2026-0831

ORD-2026-1254

INV-2026-0921
```

Database IDs should remain independent of business reference numbers.

---

# 27. Customer Dashboard

The customer dashboard is the central operational home.

It should immediately answer:

> What is happening?

> What needs my attention?

Suggested dashboard:

```text
Welcome back

Needs Your Attention

2
Pending Approvals

1
Outstanding Invoice

1
Testing Request

-------------------------------------

Active Projects        3

Open Requests          2

Support Tickets        1

My Software            5

Upcoming Renewals      2

-------------------------------------

Recent Activity
```

---

# 28. Customer Dashboard Navigation

Suggested modules:

```text
Dashboard

Marketplace

My Software

Projects

Requests

Customizations

Tickets & Support

Testing

Quotes

Orders

Invoices

Payments

Subscriptions

Renewals

Tech Assistant

Files

Notifications

Organization

Account
```

---

# 29. My Software

Purchased software should live permanently under My Software.

Example:

```text
CRM Pro

Version
2.4.1

Licence
Active

Updates
Available

Support
Active until 14 August 2027
```

Actions:

* Download
* View Licence
* View Changelog
* View Documentation
* Open Demo
* Request Installation
* Request Customization
* Request Support
* Renew Support

---

# 30. Core Workflow 3 — Customer Service Portal

Customer Service should have a dedicated operational experience.

This should not simply be a generic admin table.

The customer service team should be able to manage customer relationships from request through resolution.

---

# 31. Customer Service Dashboard

Suggested overview:

```text
New Requests                 18

Awaiting Staff Response       7

Waiting for Customer          9

Quotes Awaiting Approval     11

Open Tickets                 24

Urgent Tickets                3

Customization Requests        8

Customers Needing Follow-Up   6
```

---

# 32. Customer Service Work Queue

The portal should provide operational queues such as:

* New Custom Build Requests
* New Customization Requests
* Unassigned Tickets
* Waiting for Innovatrix
* Waiting for Customer
* Overdue Follow-ups
* Quotes Awaiting Response
* Payments Awaiting Customer
* Testing Awaiting Customer
* Recently Escalated
* Urgent Requests

This makes the system operational rather than merely informational.

---

# 33. Customer 360 View

Customer service should be able to open a customer and see a complete business history.

Example:

```text
ABC Property Ltd

Primary Contact:
John Smith

Customer Since:
2026

----------------------------------

Active Projects        2

Owned Products         3

Open Tickets           1

Pending Quotes         1

Subscriptions          2

Outstanding Balance    £420

----------------------------------

Timeline

12 Aug
Customization submitted

13 Aug
Technical review completed

14 Aug
Quote issued

15 Aug
Customer asked question
```

---

# 34. Requirements Management

Staff should be able to review:

* AI conversation
* AI-generated requirements summary
* customer attachments
* customer notes
* selected marketplace product
* customization requests
* suggested features
* technical notes

Staff should be able to:

* ask clarification questions
* edit internal interpretation
* add internal notes
* assign technical reviewer
* request customer action
* escalate

Customer-confirmed requirements should not be silently changed by staff.

Internal interpretation and customer-facing requirements should remain distinguishable.

---

# 35. Ticket Management

Ticketing should support:

```text
Ticket

├── Reference
├── Customer
├── Organization
├── Subject
├── Description
├── Category
├── Priority
├── Status
├── Assigned Team
├── Assigned User
├── Related Product
├── Related Project
├── Related Order
├── Attachments
├── Customer Messages
├── Internal Notes
├── SLA
└── Activity History
```

---

# 36. Ticket Statuses

Potential statuses:

```text
New

Assigned

In Review

In Progress

Waiting for Customer

Waiting Internally

Escalated

Resolved

Closed
```

Statuses should have controlled transitions.

---

# 37. Ticket Communication

Tickets should provide conversation-style communication.

Example:

```text
Customer
12:15 PM

The report page shows an error whenever
I select January.

[error.png]


Support Agent
12:34 PM

Thanks. We have reproduced the issue
and passed it to the technical team.


Internal Note
12:36 PM

Likely date range validation issue.
Assigned to Backend Team.
```

Internal messages must never be exposed to customers.

---

# 38. Unified Communication Architecture

The system should consider a reusable conversation/message model.

Conversations may belong to:

* Custom Requests
* Customization Requests
* Projects
* Tickets
* Change Requests

Messages may contain:

* Sender
* Recipient context
* Message
* Attachments
* Visibility
* Timestamp
* System-generated state changes

---

# 39. Follow-Up Management

Customer service staff should be able to schedule internal follow-ups.

Examples:

```text
Follow up with customer tomorrow.

Customer promised requirements by Friday.

Check payment status Monday.

Call customer after UAT.
```

A follow-up should have:

* owner
* due date
* related customer
* related request/project/ticket
* status
* notes

Overdue follow-ups should appear prominently.

---

# 40. Staff Assignment

Requests should support assignment.

Examples:

```text
Custom Build Request
→ Customer Service Agent
→ Technical Analyst
→ Project Manager

Customization
→ Customer Service
→ Product Specialist
→ Developer

Support Ticket
→ Support Agent
→ Engineering if escalated
```

Assignment history should be preserved.

---

# 41. Core Workflow 4 — Marketplace Management

Marketplace management should support far more than basic product CRUD.

Administrators should be able to create a complete distributable software package.

---

# 42. Marketplace Product Creation

Suggested workflow:

```text
Create Product
↓
Basic Information
↓
Category / Industry
↓
Features
↓
Technology
↓
Media
↓
Pricing
↓
Licensing
↓
Product Files
↓
Versions
↓
Demo
↓
Test Credentials
↓
Installation Options
↓
Customization Options
↓
Documentation
↓
SEO
↓
Review
↓
Publish
```

---

# 43. Product Configuration

Possible product settings:

```text
Product Type

Category

Industry

Technology Stack

Current Version

Purchase Model

Licence Type

Download Availability

Support Duration

Update Duration

Demo Type

Customization Available

Installation Available

Hosting Available

Maintenance Available

Visibility

Featured Status

Publishing Status
```

---

# 44. Product Uploads

Product files should use secure object storage.

Administrators should upload:

* application package
* source package
* documentation
* database files
* setup guide
* sample data
* related assets

Each release should belong to a product version.

Example:

```text
CRM Pro
└── Version 2.4.1
    ├── crm-pro-2.4.1.zip
    ├── documentation.pdf
    └── changelog.md
```

Never use publicly guessable storage paths for paid product downloads.

---

# 45. Product Versioning

Product versions should support:

```text
Version Number

Release Date

Release Notes

Changelog

Minimum Requirements

Download Package

Status

Update Eligibility
```

Customers should see versions according to their entitlement.

---

# 46. Product Publishing Lifecycle

Potential lifecycle:

```text
Draft
↓
Internal Review
↓
Testing
↓
Ready
↓
Published
↓
Deprecated
↓
Archived
```

Products should not necessarily become publicly purchasable immediately after upload.

---

# 47. Internal Product Testing

Before publication, Innovatrix should be able to record product validation.

Testing areas may include:

* installation
* authentication
* major workflows
* demo credentials
* database setup
* documentation
* security review
* download package
* environment requirements
* payment integrations where relevant

Product testing should eventually support a checklist.

---

# 48. Installation Instructions

Marketplace products should have structured installation requirements.

Example:

```text
Requirements

PHP 8.3+

PostgreSQL 15+

Node.js 20+

Redis Optional
```

And:

```text
Deployment Options

[ ] Self Install

[ ] Innovatrix Installation

[ ] Innovatrix Managed Hosting
```

---

# 49. Service Add-ons

Marketplace administrators should be able to attach services to products.

Examples:

```text
Install for Me

Deploy to AWS

Deploy to VPS

Brand Customization

Payment Gateway Setup

Email Configuration

Data Migration

Priority Support

Monthly Maintenance
```

Add-ons may be:

* fixed price
* starting price
* quote required

---

# 50. Product Customization Configuration

Administrators should be able to specify:

```text
Customization Available: Yes

AI Customization Workflow: Enabled

Technical Review Required: Yes

Starting Price: Optional

Typical Turnaround: Optional
```

Products may define suggested customization areas.

Example:

```text
Branding

User Roles

Reports

Payment Methods

Workflows

Integrations

Notifications

Dashboard
```

These suggestions can help guide the AI assistant.

---

# 51. Quotes & Estimates

Custom builds, modifications and complex services may result in quotes.

Quotes should support:

* scope
* deliverables
* exclusions
* line items
* taxes
* discounts
* payment terms
* timeline
* expiration
* notes
* attachments

Customer actions:

```text
Accept

Reject

Ask Question
```

---

# 52. Quote to Work Conversion

Example:

```text
Request
↓
Quote
↓
Customer Accepts
↓
Deposit / Payment
↓
Project or Work Order Created
```

A simple customization may create a work order.

A significant customization may create a full project.

---

# 53. Projects

Projects should represent substantial delivery work.

```text
Project

├── Customer
├── Source Request
├── Quote
├── Scope
├── Team
├── Status
├── Milestones
├── Tasks
├── Files
├── Deliverables
├── Environments
├── Messages
├── Testing
├── Change Requests
├── Billing
└── Activity
```

---

# 54. Project Lifecycle

Example:

```text
Planning

Design

Development

Internal Testing

Customer Testing

Changes Required

Awaiting Approval

Deployment

Delivered

Maintenance
```

Projects should not be forced through stages that do not apply.

---

# 55. Customer Testing / UAT

When work is ready for customer review:

```text
Project
↓
Version Ready for Testing
↓
Customer Notification
↓
Testing Page
↓
Open Testing Environment
↓
Submit Feedback
```

Customer actions:

```text
Approve

Report Issue

Request Change
```

Formal approval should capture:

* user
* timestamp
* version
* comments

---

# 56. Change Requests

After scope approval or project delivery, additional functionality should use Change Requests.

Example:

```text
Customer:
Add WhatsApp notifications.

↓
Change Request

↓
Review

↓
Estimate

↓
Customer Approval

↓
Payment if applicable

↓
Implementation

↓
Testing

↓
Completion
```

---

# 57. Distinguish Bugs from Changes

The platform should help avoid confusion between:

```text
Bug
=
Agreed functionality does not work correctly.

Change Request
=
Customer wants functionality that was not part of
the agreed implementation.
```

Staff should be able to reclassify requests when appropriate.

---

# 58. Technical Services

Innovatrix should support standalone services such as:

* Installation
* Configuration
* Deployment
* DevOps
* Maintenance
* Version upgrades
* Database work
* Server management
* Domain setup
* DNS
* SSL
* Email configuration
* API integrations
* Performance improvement
* Security updates
* Migration
* Backup setup
* Monitoring

---

# 59. Hire a Tech Assistant

Customers may purchase technical assistance.

Possible models:

```text
Pay As You Go

5 Hours

10 Hours

20 Hours

Monthly Retainer
```

Customer:

```text
Purchase Hours
↓
Submit Task
↓
Task Assigned
↓
Work Logged
↓
Customer Updated
↓
Task Completed
↓
Balance Updated
```

---

# 60. Tech Assistant Hours

The system should track:

```text
Purchased

Consumed

Reserved

Remaining
```

Time entries should belong to individual tasks.

Staff should not simply edit balances without audit history.

---

# 61. Orders

Orders may contain:

* Products
* Licences
* Add-ons
* Services
* Technical-hour bundles
* Maintenance plans
* Support
* Setup services

Order information must preserve historical pricing.

Never derive old order totals from current marketplace prices.

---

# 62. Payments

Payment architecture should support:

* One-time purchases
* Deposits
* Full project payments
* Milestone payments
* Subscription payments
* Renewals
* Refunds

Payment events should be:

* verified
* idempotent
* audited

---

# 63. Invoices

Invoices may originate from:

* Marketplace orders
* Custom builds
* Customizations
* Change Requests
* Maintenance
* Technical assistance
* Renewals

Statuses:

```text
Draft

Issued

Partially Paid

Paid

Overdue

Cancelled

Refunded
```

---

# 64. My Software & Entitlements

A customer purchasing a product receives an entitlement.

Conceptually:

```text
Customer
↓
Order
↓
Order Item
↓
Product Entitlement
↓
Licence
↓
Download Access
```

Entitlement should control:

* product ownership
* download versions
* support eligibility
* updates
* licence validity

---

# 65. Licensing

Potential licence types:

* Single Project
* Single Installation
* Multi Installation
* Commercial
* Developer
* SaaS
* Subscription
* Lifetime

Conceptually:

```text
Licence

├── Customer
├── Product
├── Order
├── Key
├── Type
├── Status
├── Activation Limit
├── Activations
├── Expires At
└── Support Expires At
```

---

# 66. Downloads

Paid product downloads must be protected.

Use:

* authorization checks
* entitlement checks
* temporary signed URLs
* download logs

Do not expose permanent public download links.

---

# 67. Maintenance & Support

Customers should be able to attach maintenance to:

* Marketplace products
* Customized marketplace products
* Custom-built applications

Potential plans:

```text
Essential

Business

Managed
```

Coverage may include:

* updates
* backups
* monitoring
* bug fixes
* technical hours
* priority support
* infrastructure support

---

# 68. Renewals

Track renewals for:

* licences
* support
* maintenance
* hosting
* domains
* infrastructure
* subscriptions
* retainers

Customers should receive reminders before expiry.

---

# 69. Notifications

The platform requires centralized notifications.

Initial channels:

```text
In-App

Email
```

Future channels may include:

* SMS
* Push
* WhatsApp or another messaging provider

Events include:

* Request submitted
* Staff responded
* Quote available
* Payment required
* Payment received
* Product available
* Ticket response
* Work assigned
* Testing available
* Approval required
* Renewal approaching
* Subscription failure

---

# 70. Activity Timeline

Important resources should display a chronological timeline.

Example:

```text
14 Aug 10:31
Customization submitted.

14 Aug 11:15
Assigned to Sarah.

14 Aug 13:42
Technical review started.

15 Aug 09:03
Additional information requested.

15 Aug 10:17
Customer responded.
```

This should be generated from canonical business events.

---

# 71. AI Architecture

AI should be treated as an application capability, not the owner of business state.

Potential AI functions:

* Requirement interviews
* Requirement summarization
* Feature suggestions
* Marketplace recommendations
* Clarification suggestions
* Technical/non-technical translation
* Ticket classification
* Customer-service drafting assistance
* Internal requirement summaries

The source of truth remains the application database.

---

# 72. AI Conversation Persistence

AI requirement sessions should persist.

Conceptually:

```text
AI Session

├── User
├── Organization
├── Context Type
├── Context Product
├── Messages
├── Structured Answers
├── Suggested Features
├── Confirmed Requirements
├── Summary
├── Status
└── Submitted Request
```

A customer should be able to leave and continue later.

---

# 73. AI Safety & Business Boundaries

AI should not independently:

* set final pricing
* promise delivery dates
* approve contracts
* approve refunds
* confirm technical feasibility
* modify customer billing
* expose internal staff notes
* expose another customer's data

AI outputs should be treated as suggestions unless explicitly confirmed.

---

# 74. Search & Discovery

Marketplace search should support:

* keyword
* categories
* industries
* technology
* features
* price
* product type

Future semantic search could allow queries such as:

> software for managing landlords and rent

and return relevant marketplace products.

Initial implementation should not require advanced AI search unless justified.

---

# 75. Authentication

Support:

* Registration
* Login
* Email verification
* Password reset
* Secure sessions
* Optional OAuth
* Future MFA

Authentication and authorization should be enforced server-side.

---

# 76. Organizations

Innovatrix should support business/customer organizations.

```text
User
└── Organization
    ├── Owner
    ├── Admin
    ├── Billing
    ├── Technical Contact
    └── Member
```

Resources such as projects, software and invoices should generally belong to an organization/account context.

---

# 77. Innovatrix Staff Roles

Potential internal roles:

* Super Admin
* Customer Service
* Sales
* Technical Analyst
* Developer
* Project Manager
* Support Agent
* Marketplace Manager
* Finance
* DevOps
* Content Manager

Use permissions rather than one universal admin flag.

---

# 78. High-Level Domain Model

Potential primary entities:

```text
User

Organization
OrganizationMember

StaffProfile
Role
Permission

Product
ProductCategory
ProductIndustry
ProductTechnology
ProductFeature
ProductMedia
ProductVersion
ProductFile
ProductDemo
ProductDemoCredential
ProductAddon
ProductPrice

Cart
CartItem

Order
OrderItem

ProductEntitlement
Licence
LicenceActivation
Download

AIConversation
AIMessage
Requirement
RequirementSuggestion

CustomerRequest
CustomizationRequest

Quote
QuoteItem

Project
ProjectMember
Milestone
Task
Deliverable

TestingSession
TestingFeedback
Approval

ChangeRequest

SupportTicket

Conversation
Message

FollowUp

Service
ServicePackage

TechAssistantPackage
TechAssistantBalance
TechAssistantTask
TimeEntry

MaintenancePlan
CustomerMaintenancePlan

Subscription
Renewal

Invoice
InvoiceItem
Payment
Refund

Sandbox
Environment

File
Attachment

Notification
NotificationPreference

ActivityEvent
AuditLog
```

These are conceptual entities.

Claude should refine the ERD before creating the final schema.

---

# 79. Recommended Architecture

Use a modular monolith initially.

```text
Next.js Application

├── Public Website
├── Marketplace
├── Customer Portal
├── Customer Service Portal
├── Admin Portal
└── API / Integrations

        ↓

Domain / Application Layer

├── Identity
├── Marketplace
├── Commerce
├── AI Requirements
├── Requests
├── Projects
├── Support
├── Billing
├── Licensing
├── Sandboxes
├── Notifications
└── Operations

        ↓

PostgreSQL
Object Storage
Queue / Jobs
Cache where required

        ↓

External Services

Payments
Email
AI Provider
Monitoring
Cloud / Deployment APIs
```

Avoid microservices until there is a concrete operational reason.

---

# 80. Next.js Application Structure

Use the modern App Router.

Illustrative structure:

```text
src/

├── app/
│
│   ├── (public)/
│   │   ├── marketplace/
│   │   ├── products/
│   │   ├── services/
│   │   ├── custom-software/
│   │   └── tech-assistant/
│   │
│   ├── (auth)/
│   │
│   ├── dashboard/
│   │   ├── software/
│   │   ├── projects/
│   │   ├── requests/
│   │   ├── customizations/
│   │   ├── tickets/
│   │   ├── testing/
│   │   ├── orders/
│   │   ├── invoices/
│   │   └── settings/
│   │
│   ├── staff/
│   │   ├── customers/
│   │   ├── queue/
│   │   ├── requests/
│   │   ├── tickets/
│   │   ├── followups/
│   │   └── quotes/
│   │
│   ├── admin/
│   │   ├── marketplace/
│   │   ├── products/
│   │   ├── projects/
│   │   ├── users/
│   │   ├── billing/
│   │   └── settings/
│   │
│   └── api/
│
├── features/
│   ├── marketplace/
│   ├── commerce/
│   ├── requirements/
│   ├── requests/
│   ├── projects/
│   ├── tickets/
│   ├── licensing/
│   ├── billing/
│   └── notifications/
│
├── components/
├── lib/
├── services/
├── repositories/
├── validators/
├── types/
└── config/
```

Exact structure may be refined after domain modeling.

---

# 81. Server Components

Prefer React Server Components by default.

Use Client Components for genuine interaction such as:

* AI chat
* Rich forms
* Drag-and-drop upload
* Interactive filters
* Cart interaction
* Charts
* Real-time messages

Sensitive business logic must remain server-side.

---

# 82. Application Services

Do not place business logic directly inside:

* React components
* route handlers
* server actions

Use dedicated application/domain services.

Example:

```text
Checkout Action
↓
CheckoutService
↓
Validate Cart
↓
Create Order
↓
Start Payment
```

---

# 83. Database

Use a relational database.

PostgreSQL is the preferred default.

Database design should make good use of:

* foreign keys
* unique constraints
* indexes
* transactions
* state fields
* auditability

An appropriate TypeScript ORM may be used after evaluation.

---

# 84. Money

Never use floating-point values for money.

Use:

* integer minor units

or

* appropriate precise decimal types

Example:

```text
£299.99

29999 minor units
```

---

# 85. File Storage

Use object storage for:

* Product downloads
* Product screenshots
* Customer attachments
* Project files
* Deliverables
* Documents
* Testing screenshots

Database stores metadata and access rules.

---

# 86. Background Jobs

Background processing should handle:

* emails
* notifications
* sandbox provisioning
* sandbox destruction
* product-package processing
* large file operations
* invoice creation
* scheduled reminders
* renewal reminders
* external callbacks
* deployment operations
* webhook follow-up processing

Jobs should be retryable and observable.

---

# 87. Webhooks

External webhooks may include:

* Payments
* Email events
* Subscription events
* Deployment callbacks
* Sandbox provisioning callbacks

Webhook handlers must:

* verify signatures
* be idempotent
* store processing status
* tolerate duplicate delivery

---

# 88. Security

Security requirements include:

* Server-side authorization
* Secure authentication
* Rate limiting
* Input validation
* Output encoding
* Secure cookies
* CSRF protection where applicable
* Secure file handling
* Signed downloads
* Secret management
* Audit logging
* Webhook verification
* Security headers
* Dependency monitoring
* Tenant isolation

Never expose server secrets to browser code.

---

# 89. Credentials

Customers may eventually need to provide deployment credentials.

Credentials must not be casually inserted into:

* tickets
* project notes
* AI conversations
* normal message fields

Design a dedicated secure-secret workflow if this capability is introduced.

---

# 90. Audit Trail

Important actions should be auditable.

Examples:

* Quote issued
* Quote accepted
* Payment received
* Product published
* Product downloaded
* Licence generated
* Customer requirement changed
* Staff assignment changed
* Testing approved
* Refund issued
* User permission changed

---

# 91. State Machines

Important business resources should use explicit transition rules.

Examples:

```text
CustomerRequest

Draft
→ Submitted
→ Under Review
→ Waiting for Customer
→ Technical Review
→ Quoted
→ Approved
→ Converted
```

And:

```text
Customization

Submitted
→ Reviewing
→ Clarification Required
→ Quoted
→ Approved
→ In Progress
→ Testing
→ Completed
```

State transitions must be validated server-side.

---

# 92. Events

Important internal business events may include:

```text
RequestSubmitted

CustomizationSubmitted

QuoteIssued

QuoteAccepted

PaymentReceived

OrderCompleted

LicenceIssued

ProjectCreated

TicketCreated

TicketEscalated

TestingReady

TestingApproved

ChangeRequested

ProductPublished

RenewalApproaching
```

Events may trigger:

* notifications
* activity records
* background work
* staff queues

Avoid unnecessary distributed event infrastructure.

---

# 93. Search Engine Optimization

Public marketplace pages should support strong SEO.

Use:

* metadata
* canonical URLs
* sitemap
* robots configuration
* structured data
* semantic markup
* Open Graph
* server rendering where appropriate

Important indexed pages:

* Products
* Categories
* Industries
* Services
* Documentation

---

# 94. Performance

Consider:

* server rendering
* Server Components
* optimized images
* CDN
* pagination
* caching
* database indexes
* efficient queries
* lazy loading

Do not load thousands of products into the browser simply to filter them.

---

# 95. Observability

Production should eventually include:

* error tracking
* request tracing
* application logs
* payment monitoring
* queue monitoring
* sandbox monitoring
* deployment monitoring
* audit logs

---

# 96. Testing Strategy

Testing should cover:

### Unit Tests

Business logic.

### Integration Tests

Database and external service boundaries.

### Application Tests

Domain workflows.

### End-to-End Tests

Critical customer journeys.

Example:

```text
Marketplace
→ Product
→ Cart
→ Checkout
→ Payment
→ My Software
→ Download
```

Another:

```text
Product
→ Request Customization
→ AI Requirements
→ Submit
→ Staff Review
→ Quote
```

Another:

```text
Custom Build
→ AI Conversation
→ Submit
→ Dashboard
→ Staff Communication
```

Another:

```text
Ticket
→ Agent Response
→ Escalation
→ Customer Response
→ Resolution
```

---

# 97. CI/CD

Typical development workflow:

```text
Pull Request

↓
Lint

↓
Type Check

↓
Tests

↓
Build

↓
Security Checks

↓
Review

↓
Merge

↓
Deploy
```

Environments:

```text
Local

Development

Staging / UAT

Production
```

---

# 98. Suggested MVP

## Phase 1 — Platform Foundation

Build:

* Public website
* Authentication
* Marketplace
* Search/filter
* Product details
* Demo configuration
* Cart
* Checkout
* Payments
* My Software
* Downloads
* Customer dashboard
* Basic admin

---

## Phase 2 — AI & Requirements

Build:

* AI custom-build assistant
* AI customization assistant
* Conversation persistence
* Requirements summaries
* Requests
* Customer Service portal
* Customer communications
* Staff queues
* Follow-ups

---

## Phase 3 — Delivery Operations

Build:

* Quotes
* Projects
* Project milestones
* Testing
* UAT
* Change Requests
* Ticketing
* Staff assignment
* Invoices

---

## Phase 4 — Product Lifecycle

Build:

* Advanced licensing
* Product versions
* Update entitlements
* Maintenance
* Subscriptions
* Renewals
* Tech Assistant

---

## Phase 5 — Infrastructure Automation

Build:

* Dynamic sandboxes
* Automated installation
* Deployment services
* Infrastructure integrations
* Advanced monitoring

---

# 99. Critical User Journeys

## Marketplace — As-Is

```text
Marketplace
→ Search / Filter
→ Product
→ Demo
→ Buy As-Is
→ Cart
→ Checkout
→ Payment
→ Dashboard
→ My Software
→ Download
```

---

## Marketplace — Modification

```text
Marketplace
→ Product
→ Request Modification
→ AI Assistant
→ Requirements
→ Submit
→ Dashboard
→ Staff Review
→ Quote
→ Payment
→ Customization
→ Testing
→ Delivery
```

---

## Custom Build

```text
Build Software
→ AI Assistant
→ Business Discovery
→ Suggestions
→ Requirements Summary
→ Submit
→ Dashboard
→ Customer Service
→ Technical Review
→ Quote
→ Payment
→ Project
→ Testing
→ Delivery
```

---

## Support

```text
Dashboard
→ Create Ticket
→ Customer Service
→ Technical Escalation if Required
→ Resolution
→ Customer Confirmation
```

---

## Marketplace Administration

```text
Admin
→ Create Product
→ Upload Files
→ Configure Pricing
→ Configure Licence
→ Configure Demo
→ Add Test Credentials
→ Add Installation Options
→ Test
→ Review
→ Publish
```

---

# 100. UX Principle — Progressive Complexity

A central Innovatrix design principle should be:

> **Show the customer only the complexity they currently need.**

A business customer should be able to say:

> I need customers to book appointments online.

without being asked immediately:

> What REST API architecture do you require?

The platform can progressively discover technical requirements when necessary.

---

# 101. UX Principle — Never Lose Context

Every request should retain its complete context.

If a customer starts from:

```text
Marketplace
→ CRM Pro
→ Request Modification
```

staff should not receive a generic ticket saying:

> Customer wants CRM.

They should automatically see:

```text
Base Product:
CRM Pro v2.4.1

Customer:
ABC Ltd

AI Conversation:
Available

Requirements:
Available

Product Demo:
Available

Product Technical Information:
Available
```

Context should flow through the system automatically.

---

# 102. UX Principle — Action-Oriented Dashboards

Dashboards should prioritize actions, not decorative statistics.

Customer:

```text
Needs Your Attention

Approve Quote

Test New Version

Pay Invoice

Respond to Support
```

Customer service:

```text
Needs Attention

7 Unanswered Requests

3 Overdue Follow-ups

2 Urgent Tickets

5 Customers Waiting for Quote
```

---

# 103. Architecture Principle — Single Source of Truth

Avoid duplicating business state across modules.

Examples:

Payment provider ≠ payment source of truth alone.

Marketplace UI ≠ product source of truth.

AI summary ≠ customer-confirmed requirement automatically.

Canonical data should exist in the application database with proper external synchronization.

---

# 104. Architecture Principle — AI Is a Layer, Not the Platform

The system must remain functional even if:

* an AI provider is temporarily unavailable
* AI output is incorrect
* staff need to edit or override AI suggestions

AI improves:

* discovery
* requirement collection
* summarization
* recommendations

but deterministic application logic controls:

* purchases
* pricing
* permissions
* projects
* payments
* licences
* tickets
* approvals

---

# 105. Architecture Principle — Long-Term Customer Lifecycle

The platform should be designed so that one marketplace purchase can evolve into:

```text
Product Purchase

↓
Installation

↓
Customization

↓
Hosting

↓
Support

↓
Maintenance

↓
Change Requests

↓
Renewals

↓
Additional Products
```

Similarly, a custom project can evolve into:

```text
Custom Build

↓
Delivery

↓
Maintenance

↓
Support

↓
Enhancements

↓
Version Upgrades

↓
Additional Projects
```

---

# 106. Expected Next Deliverables From Claude

Before beginning major implementation, Claude should use this document to produce:

1. Full information architecture.
2. Complete route map.
3. Marketplace UX flow.
4. Customer portal UX flow.
5. Customer-service portal UX flow.
6. Administrative portal UX flow.
7. AI requirement-assistant architecture.
8. Domain/module boundaries.
9. ERD.
10. Database schema proposal.
11. Roles and permissions matrix.
12. State-transition definitions.
13. Cart and checkout architecture.
14. Payment architecture.
15. Licensing and entitlement architecture.
16. Product-version architecture.
17. File-storage architecture.
18. Demo/sandbox architecture.
19. Notification architecture.
20. Ticketing architecture.
21. Customer follow-up architecture.
22. Quote/project conversion architecture.
23. Testing/UAT architecture.
24. Background-job architecture.
25. Security model.
26. Next.js codebase structure.
27. API/server-action strategy.
28. Testing strategy.
29. CI/CD architecture.
30. MVP delivery roadmap.
31. Architectural Decision Records requiring stakeholder input.

Claude should identify ambiguities and architectural trade-offs before implementing irreversible foundations.

---

# 107. Final Product Vision

Innovatrix should not behave like:

> A website where code files are sold.

It should behave like:

> **A complete software acquisition and delivery platform.**

A customer may enter Innovatrix through any of these doors:

```text
"I found software I want."

"I found software but need some changes."

"I need completely new software."

"I need someone to fix what I already have."

"I need help installing software."

"I need DevOps assistance."

"I need ongoing technical support."
```

Regardless of the entry point, the platform should transition them naturally into one unified customer relationship:

```text
DISCOVERY

↓
REQUIREMENT

↓
PURCHASE / QUOTE

↓
DELIVERY

↓
DASHBOARD

↓
COMMUNICATION

↓
TESTING

↓
SUPPORT

↓
MAINTENANCE

↓
FUTURE WORK
```

That unified lifecycle is the architectural foundation of Innovatrix.

The objective is not merely to create Marketplace pages, AI forms, tickets and dashboards independently.

The objective is to create **one coherent operating system through which Innovatrix sells software, understands requirements, performs technical work, communicates with customers and manages the entire post-purchase relationship.**
