/**
 * The CoSetup privacy policy — the text as counsel supplied it.
 *
 * ## Verbatim, and that is the whole rule for this file
 *
 * This is a legal instrument. Every sentence in it allocates a right or an
 * obligation, so it is copied from the supplied document character for
 * character and **must not be edited for style, length or house voice**. Fixing
 * a comma here changes a contract.
 *
 * ## Why a template literal rather than a `.md` file read at runtime
 *
 * Nothing else in `src/` touches the filesystem, and a route that does needs
 * Next's file tracing to agree with it at deploy time — a failure that surfaces
 * as a blank legal page in production and nowhere before it. A string in a
 * module is bundled by construction. The content is still one contiguous block,
 * so replacing it is a paste rather than a merge.
 *
 * The source document contains no backticks and no `${`, so the literal needs no
 * escaping; check that again before pasting a revision.
 *
 * ## Updating it
 *
 * Replace the whole literal, and change the "Last updated" line inside it — the
 * page reads that date out of the text rather than holding a second copy that
 * could disagree with it.
 */
export const PRIVACY_POLICY = `# CoSetup Privacy Policy

**Last updated: 28 August 2026**

CoSetup respects your privacy and is committed to handling personal information responsibly, transparently and securely.

This Privacy Policy explains how personal information is collected, used, shared and protected when you visit or use CoSetup, purchase software or services, request custom work, communicate with us, apply to become a vendor, sell through the Platform or otherwise interact with CoSetup.

## 1. Who we are

CoSetup is a trading name of **Perfect Gateway LTD**.

Perfect Gateway LTD operates the CoSetup platform and is generally the data controller responsible for personal information processed for the purposes described in this Privacy Policy.

In some circumstances, particularly when providing technical services involving data controlled by a business customer, we may process information on that customer's instructions rather than for our own purposes. Where appropriate, separate data-processing terms may apply.

In this Privacy Policy:

* **"CoSetup", "we", "us" and "our"** mean Perfect Gateway LTD trading as CoSetup;
* **"Platform"** means CoSetup's website, customer and vendor areas, applications and associated services;
* **"Customer"** includes customers and prospective customers; and
* **"Vendor"** means a person or business applying to sell or selling products or services through CoSetup.

---

# INFORMATION WE COLLECT

## 2. Account and profile information

When you create or manage a CoSetup account, we may collect information such as:

* your name;
* email address;
* contact information;
* account preferences;
* organisation or business details;
* account roles and permissions;
* authentication and account-security information; and
* information associated with your account status.

We use this information to create and administer accounts, authenticate users, provide Platform functionality, communicate with users and protect accounts from unauthorised access.

**Lawful basis:** performance of a contract, steps taken at your request before entering into a contract, and our legitimate interests in operating and securing the Platform.

---

## 3. Organisation and business information

If you use CoSetup for a company or other organisation, we may collect:

* organisation name;
* business contact details;
* billing information;
* registered or trading address;
* tax or VAT information where applicable;
* members associated with the organisation;
* roles and permissions; and
* information required to administer the organisation's relationship with CoSetup.

We use this information to provide organisation accounts, administer purchases and projects, issue invoices, manage access and comply with legal and accounting obligations.

---

## 4. Orders and transactions

When you purchase software, templates, licences or services, we collect information relating to the transaction, including:

* products or services purchased;
* order and transaction identifiers;
* purchase date;
* price and currency;
* billing information;
* payment status;
* refunds;
* disputes and chargebacks;
* applicable taxes; and
* invoices and transaction records.

Payment transactions may be processed by third-party payment providers.

Depending on the payment method, your payment provider may collect card, bank-account or other financial information directly. We generally receive transaction information and payment status rather than complete payment-card credentials.

We process transaction information to fulfil purchases, provide licences and downloads, manage refunds, maintain financial records, prevent fraud and comply with tax, accounting and legal obligations.

**Lawful basis:** performance of a contract, compliance with legal obligations and legitimate interests relating to fraud prevention and financial administration.

---

## 5. Software licences, downloads and product usage

When you obtain a product through CoSetup, we may maintain records including:

* products and versions obtained;
* licence type;
* licence identifiers or keys;
* licence status;
* authorised installations or activations;
* associated domains or installations where licensing requires them;
* downloads;
* updates and entitlements;
* support eligibility; and
* relevant technical events associated with licence administration.

We use this information to deliver products, administer licences, provide updates and support, prevent licence abuse, investigate disputes and maintain evidence of customer entitlements.

**Lawful basis:** performance of a contract and our legitimate interests in operating and protecting our software marketplace.

---

# CUSTOM REQUESTS AND PROJECTS

## 6. Custom build and customisation requests

When you ask us to build, modify, deploy, integrate, maintain or otherwise work on software, we may collect the information you provide about the proposed project.

This may include:

* business requirements;
* requested features;
* technical requirements;
* project descriptions;
* budgets;
* expected timescales;
* existing technology;
* documents;
* screenshots;
* diagrams;
* attachments;
* source code;
* database structures;
* specifications;
* links;
* examples; and
* other materials you choose to provide.

We use this information to understand the request, assess feasibility, prepare scopes and quotations, assign appropriate people, deliver the project and maintain the commercial record of the work.

**Lawful basis:** steps taken at your request before entering into a contract, performance of a contract and our legitimate interests in managing projects and customer relationships.

---

## 7. AI-assisted conversations

CoSetup may provide conversational or AI-assisted tools that help you describe what you need, explore potential solutions and structure a software request.

When you use these features, we may process:

* what you type or submit;
* responses generated during the conversation;
* attachments you provide;
* conversation history;
* technical information needed to operate the conversation; and
* information generated from the conversation, such as summaries or proposed requirements.

Information submitted to an AI-assisted feature may be sent to an AI technology provider acting as a service provider to CoSetup where this is necessary to generate responses or provide the feature.

AI assistance may help organise or interpret a request, but important commercial decisions such as final project scope, pricing and acceptance are not determined solely by an AI conversation.

Please do not place passwords, private keys, payment-card numbers or other unnecessary secrets into general AI conversations.

Where sensitive credentials are genuinely required for technical work, CoSetup may provide a more appropriate method for supplying them.

**Lawful basis:** steps taken at your request before entering into a contract, performance of a contract where applicable, and our legitimate interests in providing and improving the requirements-gathering process.

---

## 8. Quotes, contracts and project records

We may retain records relating to:

* quotations;
* accepted scopes;
* statements of work;
* milestones;
* change requests;
* project decisions;
* approvals;
* project status;
* invoices;
* deliverables;
* acceptance;
* warranties;
* support; and
* disputes.

Where an agreement or other significant commercial action is accepted electronically, we may also record technical information reasonably necessary to evidence when and how the action occurred.

We use these records to perform agreements, manage projects, maintain commercial records and establish or defend legal claims.

---

## 9. Project communications

When you communicate with CoSetup staff, vendors or other authorised participants through the Platform, we may process and retain those communications.

This may include:

* messages;
* support discussions;
* project comments;
* attachments;
* decisions;
* approvals;
* dispute communications; and
* related internal administrative records.

Access to communications is limited according to the role of the person involved and the purpose for which access is required.

---

# SOURCE CODE, INFRASTRUCTURE AND TECHNICAL SERVICES

## 10. Source code and files

If you provide source code, application files or other technical materials for customisation, deployment, maintenance, investigation or another service, those materials may contain information relating to you, your staff, customers or users.

We process these materials only as reasonably necessary to provide the requested service, secure our systems, meet legal obligations and resolve relevant disputes.

Business customers are responsible for ensuring that they have authority to provide information and systems made available to CoSetup.

Where we process personal information contained within a customer's system solely on that customer's instructions, CoSetup may act as a **processor** and the customer may remain the **controller**. Appropriate data-processing terms may apply.

---

## 11. Servers, deployments and credentials

Technical services may require temporary or continuing access to systems such as:

* hosting accounts;
* servers;
* cloud platforms;
* source-code repositories;
* databases;
* domain and DNS systems;
* deployment platforms;
* APIs;
* email systems; and
* other infrastructure.

We seek to limit access to what is reasonably necessary for the requested work.

Credentials should be supplied through methods appropriate to their sensitivity. Where appropriate, credentials should be revoked or rotated when access is no longer required.

---

## 12. Demo and testing environments

CoSetup may provide temporary demonstrations, previews or testing environments for software products.

We may process technical information necessary to provision, secure, monitor and terminate those environments.

Demo environments should not be used for real confidential, sensitive or production personal information unless CoSetup expressly provides an environment intended for that purpose.

---

# VENDORS

## 13. Vendor applications

If you apply to sell through CoSetup, we may collect information such as:

* your name;
* trading or business name;
* contact information;
* country;
* business details;
* products and technologies you work with;
* portfolio or product information;
* website or professional profiles;
* information supplied during the application process; and
* correspondence concerning your application.

We use this information to assess applications, communicate with applicants, administer the marketplace and protect customers and the Platform.

---

## 14. Vendor verification

Where verification is required, we may collect information necessary to establish the identity or legitimacy of a vendor.

Depending on the circumstances, this may include:

* identity information;
* government-issued identification;
* proof of address;
* business registration documents;
* company information;
* verification results; and
* records of verification decisions.

We process verification information to prevent fraud, protect customers, establish vendor identity, manage marketplace risk and comply with applicable legal or regulatory requirements.

Verification information is subject to access restrictions and is not made publicly available merely because someone sells through CoSetup.

**Lawful basis:** legitimate interests in fraud prevention, marketplace security and trust, and compliance with legal obligations where applicable.

---

## 15. Vendor products and marketplace activity

For approved vendors, we may process information relating to:

* submitted products;
* product reviews and approvals;
* product ownership;
* versions and updates;
* sales;
* licences;
* customer support;
* refunds;
* disputes;
* commissions;
* earnings;
* adjustments; and
* vendor performance.

We use this information to operate the marketplace and fulfil our obligations to customers and vendors.

---

## 16. Vendor payouts

To pay vendors, we may process:

* account-holder name;
* bank or payment-account information;
* payout provider information;
* country;
* currency;
* payout history;
* amounts due;
* payment references; and
* information necessary to investigate failed or disputed payouts.

Payment and banking providers may also process this information.

**Lawful basis:** performance of the Vendor Agreement, legitimate interests in administering marketplace payments and compliance with financial, tax and accounting obligations.

---

# SUPPORT, REVIEWS AND COMMUNICATIONS

## 17. Customer support

When you contact us for help, we may collect:

* your contact details;
* the content of your request;
* relevant order, product or project information;
* attachments;
* technical information needed to investigate the problem; and
* records of our response.

We use this information to provide support, investigate issues, improve our services and resolve disputes.

---

## 18. Product reviews

If you publish a product review, information forming part of that review may be visible publicly.

We may associate reviews internally with the relevant transaction to verify that they relate to a genuine purchase or experience.

Information that is displayed publicly will be identified when you submit the review or by the design of the relevant feature.

---

## 19. Service communications

We may send communications necessary to operate your relationship with CoSetup, including:

* account verification;
* password and security notices;
* order confirmations;
* invoices;
* licence information;
* download information;
* project messages;
* quotation updates;
* support responses;
* vendor notices;
* payout information;
* material changes to services; and
* important legal or security communications.

These are operational communications and may be necessary even where you have chosen not to receive marketing.

---

## 20. Marketing communications

Where permitted by law, we may send information about CoSetup products, services or developments that may be relevant to you.

Where consent is required, we will obtain it.

You can opt out of marketing communications at any time using the unsubscribe method provided or by contacting us.

Opting out of marketing does not stop necessary transactional or service communications.

---

# SECURITY AND PLATFORM OPERATION

## 21. Technical and security information

When you access CoSetup, we may automatically process technical information such as:

* IP address;
* browser and device information;
* operating system;
* approximate location derived from network information;
* login events;
* request and error information;
* security events;
* timestamps; and
* other information reasonably necessary to operate and secure the Platform.

We use this information to:

* operate the Platform;
* maintain security;
* prevent abuse;
* detect fraud;
* diagnose failures;
* investigate incidents;
* enforce Platform rules; and
* maintain appropriate technical records.

**Lawful basis:** our legitimate interests in providing, maintaining and securing CoSetup.

---

## 22. Audit records

Because CoSetup facilitates commercial transactions and software projects, we may maintain audit records of significant actions.

Examples include:

* account and permission changes;
* quotation acceptance;
* contractual acceptance;
* licence actions;
* purchases and refunds;
* vendor decisions;
* project approvals;
* administrative actions; and
* security-sensitive events.

Audit records help protect customers, vendors and CoSetup and may also be required to establish what occurred in a transaction or dispute.

---

# HOW AND WHY WE USE INFORMATION

## 23. Our purposes

We process personal information where reasonably necessary to:

* provide and administer CoSetup accounts;
* operate the marketplace;
* sell and deliver digital products;
* issue and administer licences;
* provide downloads and updates;
* process payments and refunds;
* provide customer support;
* gather software requirements;
* prepare quotations;
* manage custom projects;
* provide technical services;
* administer vendor applications;
* verify vendors;
* manage vendor products and sales;
* make vendor payouts;
* maintain accounting and tax records;
* communicate with users;
* secure our systems;
* detect and prevent fraud and abuse;
* investigate complaints and disputes;
* enforce our agreements;
* establish, exercise or defend legal claims;
* comply with legal obligations; and
* develop, maintain and improve the Platform.

---

## 24. Lawful bases

Depending on why information is processed, we rely on one or more lawful bases under applicable data-protection law.

### Contract

We process information where necessary to perform a contract with you or to take requested steps before entering into one.

This includes many activities relating to accounts, purchases, licences, custom requests, quotations, projects, support and vendor relationships.

### Legal obligation

We process information where required to meet legal obligations, including certain accounting, taxation, fraud-prevention and regulatory obligations.

### Legitimate interests

We process information where necessary for legitimate business interests and those interests are not overridden by the rights and interests of affected individuals.

These interests may include:

* securing CoSetup;
* preventing fraud;
* maintaining transaction and audit records;
* improving services;
* administering customer and vendor relationships;
* resolving disputes;
* protecting intellectual property; and
* operating a reliable software marketplace.

### Consent

Where processing requires consent, we will request it.

Where consent is the lawful basis, you may withdraw it at any time. Withdrawal does not make earlier lawful processing unlawful.

---

# SHARING INFORMATION

## 25. Service providers

We use third parties to help operate CoSetup.

Depending on the service, information may be processed by providers of:

* hosting and cloud infrastructure;
* data storage;
* email delivery;
* payment processing;
* banking and payouts;
* identity or business verification;
* AI services;
* monitoring and security;
* customer communications;
* analytics;
* source-code or deployment infrastructure; and
* other technology necessary to provide CoSetup.

We aim to provide those providers only with information reasonably necessary for their function and require appropriate protections where applicable.

---

## 26. Customers and vendors

Because CoSetup is a marketplace, some information must be exchanged between customers and vendors where necessary to fulfil a transaction, provide support, perform authorised work or resolve a dispute.

We do not give vendors unrestricted access to customer information.

The information available depends on the vendor's role and the purpose for which it is required.

Similarly, customers receive only vendor information appropriate to the marketplace relationship.

---

## 27. Professional advisers

We may disclose information where reasonably necessary to professional advisers such as lawyers, accountants, auditors, insurers or security specialists who owe appropriate duties of confidentiality.

---

## 28. Legal and regulatory disclosures

We may disclose information where we reasonably believe disclosure is necessary to:

* comply with law;
* respond to a valid court order or lawful authority;
* investigate suspected fraud or crime;
* protect the rights or safety of CoSetup or others;
* enforce our agreements; or
* establish, exercise or defend legal claims.

We do not provide personal information to authorities merely because it is requested informally where a valid legal basis for disclosure is required.

---

## 29. Business transfers

If Perfect Gateway LTD or the CoSetup business is involved in a merger, acquisition, restructuring, financing, sale or transfer of all or part of its business or assets, relevant information may be disclosed to advisers and prospective parties subject to appropriate confidentiality and legal protections.

If responsibility for personal information transfers to another controller, affected users will be informed where required by law.

---

## 30. We do not sell personal information

CoSetup does not sell personal information to data brokers or advertisers.

We do not disclose customer or vendor personal information to third parties so that they can independently advertise unrelated products to you without an appropriate lawful basis.

---

# INTERNATIONAL PROCESSING

## 31. International data transfers

Some technology and service providers used by CoSetup may process information outside the United Kingdom.

Where personal information is transferred internationally, we will use an appropriate legal mechanism where required.

Depending on the destination and provider, this may include:

* a country covered by UK adequacy regulations;
* the UK International Data Transfer Agreement;
* the UK Addendum to approved Standard Contractual Clauses; or
* another lawful transfer mechanism.

We also assess additional safeguards where required.

---

# RETENTION

## 32. How long we keep information

We do not intend to keep personal information indefinitely simply because it can be stored.

Retention depends on the nature of the information and why it is needed.

In determining retention periods, we consider:

* whether an account remains active;
* whether a licence or continuing entitlement exists;
* the duration of a project or service;
* warranty and support periods;
* accounting and tax requirements;
* fraud-prevention requirements;
* legal limitation periods;
* potential disputes;
* security requirements; and
* whether information remains necessary for the purpose for which it was collected.

Different categories therefore have different retention periods.

---

## 33. Commercial and financial records

Orders, invoices, payments, refunds, commissions, payouts and related financial records may be retained for the period required by tax, accounting and other applicable laws.

These records may remain after an account has been closed.

---

## 34. Licences

Records establishing software ownership or licence entitlement may be retained while the licence remains relevant and afterwards where reasonably necessary to establish historical entitlement, prevent abuse or resolve disputes.

---

## 35. Project records

Project requirements, quotations, contractual acceptances, material project communications and delivery records may be retained for the duration of the project and afterwards for an appropriate period reflecting support obligations, potential disputes and applicable limitation periods.

---

## 36. Verification information

Vendor identity and verification information will be retained only for as long as reasonably necessary for the verification purpose, marketplace protection, fraud prevention and applicable legal obligations.

Where retaining an entire identity document is no longer necessary, we may retain a record that verification occurred and information necessary to evidence that decision.

---

## 37. Account deletion

If you request deletion of your account, we will delete or anonymise information that we no longer need.

Some information may be retained where necessary to:

* comply with law;
* maintain financial records;
* preserve legitimate licence records;
* prevent fraud;
* resolve disputes;
* establish or defend legal claims; or
* protect the security and integrity of CoSetup.

Account deletion therefore does not necessarily mean immediate deletion of every historical record associated with an account.

---

# YOUR RIGHTS

## 38. Data-protection rights

Depending on the circumstances, UK data-protection law may give you rights including:

* the right to be informed about how your personal information is used;
* the right to access personal information we hold about you;
* the right to correct inaccurate or incomplete information;
* the right to request erasure in applicable circumstances;
* the right to restrict processing in applicable circumstances;
* the right to object to certain processing;
* the right to data portability where applicable;
* rights relating to certain automated decisions; and
* the right to withdraw consent where processing is based on consent.

These rights are subject to conditions and exceptions under applicable law.

---

## 39. Exercising your rights

You may contact CoSetup to exercise a data-protection right.

We may need to verify your identity before providing, changing or deleting personal information.

We will not require more identity information than reasonably necessary for verification.

We normally respond within the period required by applicable data-protection law.

In some circumstances we may lawfully refuse or limit a request. If that happens, we will explain the reason where required.

---

## 40. Automated decision-making

CoSetup may use automation and AI to assist with activities such as requirements gathering, fraud indicators, technical analysis or administrative workflows.

We do not intend to make decisions producing legal or similarly significant effects on individuals solely through automated processing unless this is lawful and appropriate safeguards are provided.

Where applicable law requires specific information or rights concerning such a decision, we will provide them.

---

# CHILDREN

## 41. Children's information

CoSetup is a commercial software marketplace and professional services platform and is not designed for children.

We do not knowingly seek to collect personal information from children who are not legally able to enter the relevant transaction.

If we become aware that personal information has been collected from a child in circumstances where it should not have been, we will take appropriate steps.

---

# SECURITY

## 42. Protecting information

We use technical and organisational measures appropriate to the nature of the information and risks involved.

These may include, where appropriate:

* access controls;
* authentication controls;
* encryption in transit;
* restricted administrative access;
* environment separation;
* logging;
* monitoring;
* backups;
* secure development practices;
* vulnerability management; and
* controls governing staff or contractor access.

No internet service can guarantee absolute security.

Users are also responsible for protecting their account credentials and using appropriate security practices.

---

## 43. Personal data breaches

Where a personal data breach occurs, we will investigate it and take appropriate steps to contain and remediate the incident.

Where applicable law requires us to notify the Information Commissioner's Office or affected individuals, we will do so.

---

# OTHER MATTERS

## 44. Third-party websites and services

CoSetup may link to third-party websites or integrate with third-party services.

Their handling of information is governed by their own privacy practices.

This Privacy Policy does not control how an independent third party processes information for its own purposes.

---

## 45. Changes to this Privacy Policy

CoSetup and the services we provide will evolve.

We may update this Privacy Policy when our processing changes, when we introduce new services or where legal or regulatory requirements change.

The current version will be published on CoSetup with its effective or last-updated date.

Where a change materially affects how existing personal information is used, we will provide additional notice where required.

---

# CONTACT AND COMPLAINTS

## 46. Contacting CoSetup about privacy

Questions, requests or complaints concerning personal information should be directed to:

**Perfect Gateway LTD**
Trading as **CoSetup**

Website: **cosetup.net**

**Privacy contact:** privacy@cosetup.net


We should insert the company's confirmed legal details before this Policy is published.

---

## 47. Information Commissioner's Office

If you have concerns about how we use your personal information, we encourage you to contact us first so we have an opportunity to investigate.

You also have the right to complain to the **Information Commissioner's Office (ICO)**, the UK's data-protection regulator.

Information about making a complaint is available from the ICO.

---

## 48. Relationship with other CoSetup terms

This Privacy Policy explains how CoSetup handles personal information.

Your contractual use of the Platform is governed separately by the **CoSetup Terms of Service**.

Vendors are also subject to the **Vendor Agreement**.

Specific projects or services may include additional data-processing or confidentiality terms where appropriate.

Where CoSetup processes personal information solely on behalf of a business customer, a separate **Data Processing Agreement** may govern that processing.
`;
