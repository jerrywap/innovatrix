/**
 * The CoSetup terms of service — the text as counsel supplied it.
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
export const TERMS_OF_SERVICE = `# CoSetup Terms of Service

**Last updated: 28 August 2026**

These Terms of Service ("Terms") govern your access to and use of CoSetup, including purchases of software, scripts, website templates and other digital products; requests for customisation or custom software development; technical and professional services; and other services made available through CoSetup.

Please read these Terms carefully before creating an account, making a purchase, accepting a quote or otherwise using CoSetup.

By using CoSetup, creating an account, placing an order, accepting a quote or instructing us to begin work, you agree to these Terms.

If you do not agree to these Terms, you must not use CoSetup.

---

## 1. About CoSetup

CoSetup is a trading name of **Perfect Gateway LTD** ("CoSetup", "we", "us" or "our").

Perfect Gateway LTD operates the CoSetup platform at **cosetup.net**.

CoSetup provides a platform through which customers can, among other things:

* purchase licences to ready-made software and scripts;
* purchase website templates and other digital products;
* request modifications or customisations to existing products;
* commission custom software;
* request deployment, hosting, integration, migration, maintenance and other technical services;
* communicate with CoSetup and participating vendors;
* receive quotes and manage commissioned work;
* access purchased products, licences, updates and support; and
* use other functionality that we may introduce from time to time.

Where these Terms refer to the "Platform", we mean the CoSetup website, applications, dashboards, APIs and related services operated by us.

---

# PART A — GENERAL TERMS

## 2. Who these Terms apply to

These Terms apply to anyone who accesses or uses CoSetup as a customer, prospective customer, account holder or visitor.

Separate terms apply to vendors who list or supply products through CoSetup.

If you are both a customer and a vendor, these Terms apply to your activities as a customer and the applicable Vendor Agreement applies to your activities as a vendor.

---

## 3. Consumers and business customers

Some customers use CoSetup wholly or mainly for business purposes, while others may qualify as consumers under applicable law.

A **Consumer** is an individual acting wholly or mainly outside their trade, business, craft or profession.

A **Business Customer** is anyone acting for purposes relating to their trade, business, craft or profession.

Certain provisions of these Terms distinguish between Consumers and Business Customers.

Nothing in these Terms excludes, restricts or affects any statutory rights that cannot lawfully be excluded or restricted.

If there is a conflict between these Terms and mandatory consumer law, the mandatory consumer law prevails.

---

## 4. Eligibility and authority

You must have legal capacity to enter into a binding contract to use paid services on CoSetup.

If you use CoSetup on behalf of a company, organisation or other legal entity, you confirm that you have authority to bind that entity.

Where an organisation account allows multiple authorised users, actions taken by a user with the relevant permissions may be treated as actions taken on behalf of that organisation.

You are responsible for deciding who has access to your organisation and what permissions they receive.

---

## 5. Accounts

Certain features require a CoSetup account.

You must provide accurate, current and complete information and keep it reasonably up to date.

You are responsible for:

* safeguarding your password and authentication credentials;
* controlling access to your account;
* maintaining appropriate permissions for members of your organisation; and
* notifying us promptly if you reasonably believe your account has been compromised.

You must not sell, transfer or provide your account to another person without our permission.

We may require identity, business or payment verification where reasonably necessary for fraud prevention, security, regulatory compliance or provision of particular services.

---

## 6. Electronic contracting

Orders, accepted quotes, change requests and other agreements may be entered into electronically.

Where CoSetup records acceptance of an order, quote, project scope, change request or similar document, our electronic records may include:

* the account or user accepting it;
* the version accepted;
* the date and time of acceptance;
* associated project or order information; and
* other relevant audit information.

These records may be used as evidence of the agreement between us.

---

# PART B — MARKETPLACE AND DIGITAL PRODUCTS

## 7. Marketplace products

CoSetup may offer:

* software applications;
* source-code products;
* scripts;
* plugins;
* extensions;
* website templates;
* themes;
* UI templates;
* components;
* integrations;
* documentation; and
* other downloadable or digitally supplied products.

A product may have been created by Perfect Gateway LTD or by an independent vendor.

Unless a product page expressly states otherwise, **Perfect Gateway LTD is the seller of record for purchases made through CoSetup**.

Your payment is therefore made to us and your purchase contract is with us.

Where an independent vendor owns the product, that vendor retains its intellectual property rights and authorises CoSetup to distribute or license the product through the Platform.

---

## 8. Product descriptions

We aim to ensure that product descriptions accurately represent the relevant product.

A product page may describe matters such as:

* features;
* supported technology;
* system requirements;
* compatibility;
* included files;
* licence type;
* number of permitted installations;
* update period;
* support period;
* documentation;
* demo availability; and
* included or optional services.

You should review this information before purchasing.

Screenshots, videos and demonstrations are intended to help explain a product but may contain example data or environments.

Where there is a material difference between promotional imagery and the written product specification, the written specification forms the primary description unless applicable law provides otherwise.

---

## 9. Third-party products

Some marketplace products are supplied to CoSetup by independent vendors.

We may review, test or moderate products before or after publication, but this does not mean that we independently verify every line of code, dependency, claim or possible use case.

The identity of the original vendor or developer may be displayed on the relevant listing.

The existence of a vendor does not change our obligations to you where Perfect Gateway LTD is the seller under your transaction.

Questions concerning payments, refunds, licences and orders made through CoSetup should therefore be raised with CoSetup rather than bypassing the Platform.

---

## 10. Software licences

Unless expressly stated otherwise, purchasing software through CoSetup does **not** transfer ownership of the software or its copyright to you.

Instead, you receive a licence to use the product.

The applicable licence type, installation allowance and any product-specific restrictions will be displayed on the product page, checkout, licence record or other applicable purchase information.

Subject to those terms, your licence will generally be:

* non-exclusive;
* non-transferable except where expressly permitted;
* limited to the permitted number of installations or projects; and
* subject to these Terms and any product-specific licence terms.

---

## 11. Licence restrictions

Unless expressly permitted by the applicable licence, you must not:

* resell or redistribute the product as a standalone product;
* share the source code or downloadable files publicly;
* sublicense the product;
* make the product available through file-sharing services;
* publish or distribute licence keys;
* deliberately bypass licence or activation controls;
* claim ownership or authorship of the underlying product;
* use one licence for more installations than permitted; or
* use the product in a way that infringes another person's intellectual property or other rights.

Where modification of source code is reasonably expected from the nature of the product, you may modify it for your permitted use.

Modification does not transfer ownership of the underlying product to you.

---

## 12. Licence activation

Certain products may use licence keys, domain activation, installation identifiers or other technical licensing mechanisms.

You agree not to intentionally defeat these mechanisms.

Where legitimate migration, staging, domain changes or server replacement requires an activation to be reset, you may contact us.

We may deactivate a licence where:

* the purchase has been refunded;
* the payment has been reversed or charged back;
* the licence is being used materially beyond its permitted scope;
* the licence was obtained fraudulently; or
* continued activation is required to be withdrawn by law.

---

## 13. Free products

CoSetup may make some products available without charge.

Free products remain subject to applicable licence terms and intellectual property restrictions.

Unless otherwise stated, the availability of a product for free does not transfer copyright or create a right to redistribute the product.

We may discontinue free products or change the availability of future versions.

This does not retrospectively convert a legitimately obtained copy into an unauthorised copy.

---

## 14. Updates

A product may include updates for a specified period or on another basis stated on its listing.

Unless expressly stated otherwise, expiry of an included update period means that you cease receiving future updates; it does not automatically terminate your licence to versions already legitimately supplied to you.

Updates may:

* correct defects;
* improve security;
* add or remove functionality;
* maintain compatibility with third-party technologies; or
* address legal or technical requirements.

We do not guarantee indefinite compatibility with every future version of third-party software, operating systems, browsers, frameworks, hosting environments or APIs.

---

## 15. Product support

Where support is included, the applicable support period and scope will be stated with the product.

Product support generally concerns helping the purchased product operate substantially as described.

Unless expressly included, product support does not include:

* developing new features;
* substantial customisation;
* repairing changes made by you or another developer;
* managing your server;
* fixing unrelated third-party software;
* integrating systems not included in the product description;
* data entry;
* redesign work; or
* general IT consultancy.

We may offer such work separately as a paid service.

---

## 16. Demonstrations and previews

CoSetup may provide live demonstrations, screenshots, temporary demo environments or preview systems.

Demonstrations are provided to help evaluate products.

Demo environments may:

* contain sample data;
* differ in configuration from the downloadable product;
* be periodically reset;
* have functionality disabled for security reasons;
* operate on temporary infrastructure; or
* be subject to usage limits.

You must not use a demo environment to store confidential, personal, sensitive or production data.

You must not attempt to compromise, overload, scrape, reverse engineer or gain unauthorised access to demo infrastructure.

---

# PART C — ORDERS, PRICING AND PAYMENT

## 17. Prices

Prices are displayed in the currency shown on the Platform.

Applicable taxes, fees and selected add-ons will be shown as required before you complete payment.

Prices may change at any time before an order is placed.

A later price change does not retrospectively alter a completed order.

Obvious pricing errors do not oblige us to supply a product at an obviously incorrect price. If such an error affects an order, we will contact you and, where appropriate, allow you to proceed at the correct price or receive a refund.

---

## 18. Payment

Payments may be processed by third-party payment providers.

By choosing a payment method, you authorise the relevant charges.

We do not necessarily receive or store your complete payment-card details.

Payment is treated as complete when our payment provider or banking system confirms cleared payment.

For bank transfers and other non-instant methods, access may not be released until funds are received and reconciled.

---

## 19. Failed and reversed payments

If a payment fails, is reversed, refunded or subject to a successful chargeback, we may suspend or revoke access to the associated product, licence or service.

This does not prevent you from exercising legitimate statutory or contractual rights to dispute a transaction.

Fraudulent chargebacks or deliberate attempts to retain digital products after recovering payment may result in account suspension and recovery action.

---

## 20. Invoices

Where applicable, invoices and receipts will be made available electronically.

You are responsible for providing accurate billing information.

---

# PART D — CANCELLATIONS AND REFUNDS

## 21. Statutory rights

Nothing in these Terms removes rights available to Consumers under applicable consumer law.

Digital content, services and commissioned work may be subject to different statutory cancellation and remedy rules.

---

## 22. Immediate supply of digital content

Marketplace products are normally intended to be delivered electronically shortly after payment.

Where applicable law gives a Consumer a cancellation period before digital content is supplied, we may ask the Consumer to:

1. expressly consent to supply beginning during that cancellation period; and
2. acknowledge that the statutory right to cancel may be lost once supply begins.

Where required by law, we will not rely on loss of the cancellation right unless the legally required consent and acknowledgement have been obtained.

Nothing in this section removes statutory remedies where digital content is faulty, not as described or otherwise fails to comply with applicable law.

---

## 23. Marketplace refunds

Because downloadable products cannot practically be "returned" in the same manner as physical goods, refunds are assessed according to applicable law and these Terms.

A refund may be appropriate where, for example:

* the product is materially not as described;
* required files are missing;
* a material defect prevents the product performing as described and cannot reasonably be remedied;
* you were charged more than once for the same transaction; or
* applicable law otherwise requires a refund.

A refund will not normally be provided merely because:

* you changed your mind after valid immediate digital delivery where the cancellation right has lawfully been lost;
* you lack the technical knowledge required to use a product whose requirements were properly described;
* your server or environment does not meet clearly stated requirements;
* you expected functionality that was not advertised;
* you purchased the wrong product despite the description being clear; or
* you modified the product and those modifications caused the problem.

Consumer statutory rights remain unaffected.

---

## 24. Effect of a marketplace refund

Where a marketplace purchase is refunded:

* the corresponding licence terminates;
* licence activation may be revoked;
* access to downloads and future updates may be removed; and
* you must cease using the refunded product and, where reasonably possible, delete copies under your control.

---

# PART E — CUSTOM BUILDS, CUSTOMISATION AND QUOTED WORK

## 25. Requests

You may ask CoSetup to:

* build new software;
* customise an existing CoSetup product;
* customise third-party software;
* integrate systems;
* migrate software or data;
* deploy applications;
* configure infrastructure;
* perform maintenance;
* investigate technical issues; or
* perform other professional or technical work.

Submitting a request does not by itself require either party to proceed.

---

## 26. Requirements gathering and AI assistance

CoSetup may use automated or AI-assisted tools to help collect, organise, summarise or clarify project requirements.

These tools assist the requirements process but do not themselves create a binding technical specification or guarantee that a proposed solution is technically or commercially appropriate.

You are responsible for reviewing the final scope or quote before accepting it.

Where there is a conflict between preliminary discussions, AI-generated summaries and an accepted quote or specification, the accepted quote or specification prevails.

---

## 27. Quotes

Before paid commissioned work begins, we will normally provide a quote, proposal, statement of work or similar document ("Quote").

A Quote may specify:

* project scope;
* deliverables;
* assumptions;
* exclusions;
* milestones;
* estimated or fixed timescales;
* price;
* deposit;
* payment schedule;
* support or warranty arrangements;
* intellectual property arrangements;
* customer responsibilities; and
* expiry date.

A Quote becomes binding when accepted in the manner specified by CoSetup.

---

## 28. Priority of documents

If provisions conflict, the following order generally applies:

1. an expressly agreed project-specific contract or Statement of Work;
2. an accepted Quote;
3. product-specific licence terms;
4. these Terms.

A later document only overrides an earlier one to the extent that they actually conflict.

---

## 29. Deposits and milestone payments

Commissioned work may require a deposit before work begins.

The Quote will state the applicable payment structure.

Milestone payments become payable when the corresponding milestone or payment event described in the Quote occurs.

Unless required by law or otherwise agreed, amounts already earned for completed work are not refundable merely because the customer later decides not to continue the project.

---

## 30. Estimates and timescales

Where a Quote states an **estimate**, it is not a guaranteed completion date.

Where we expressly commit to a deadline, we will use reasonable care to meet it subject to:

* timely customer feedback;
* timely provision of required materials and access;
* agreed dependencies;
* approved change requests;
* third-party services; and
* circumstances outside our reasonable control.

A delay caused by the customer or a third party may result in corresponding changes to the project schedule.

---

## 31. Customer responsibilities

For commissioned work, you agree to provide reasonably required:

* requirements;
* decisions;
* feedback;
* content;
* credentials through approved secure channels;
* infrastructure access;
* APIs;
* licences;
* data;
* approvals; and
* other dependencies.

You are responsible for ensuring that you have the legal right to provide materials, software, credentials and data supplied to us.

---

## 32. Customer delays and inactive projects

Where progress depends on information, access, feedback or approval from you, we may pause work until it is received.

If a project remains inactive for a prolonged period because required customer action has not been taken, we may:

* revise the expected delivery schedule;
* archive the project;
* require outstanding invoices to be settled;
* require a restart or rescheduling fee where reasonably justified; or
* terminate the project after reasonable notice.

Any such action will not remove your obligation to pay for work already properly completed.

---

## 33. Change requests

Anything materially outside the accepted scope is a **Change Request**.

We are not required to perform additional work merely because it is related to the original project.

A Change Request may affect:

* price;
* delivery date;
* architecture;
* milestones; or
* other project terms.

We will normally communicate the effect before undertaking chargeable additional work.

---

## 34. Acceptance and testing

Where a project includes an acceptance process, you must review the deliverables within the period stated in the Quote.

You should identify reproducible defects or material deviations from the agreed specification.

A request for functionality outside the agreed specification is a Change Request rather than a defect.

Where no specific acceptance procedure is stated, acceptance does not prevent you from reporting genuine defects that are covered by applicable law or an agreed warranty/support period.

---

# PART F — INTELLECTUAL PROPERTY IN CUSTOM WORK

## 35. Existing intellectual property

Each party retains ownership of intellectual property it owned or developed independently before the project.

This includes:

* pre-existing software;
* libraries;
* frameworks;
* templates;
* internal tools;
* development utilities;
* methodologies;
* know-how;
* reusable components; and
* third-party materials.

---

## 36. Customer materials

You retain ownership of materials you provide to us.

You grant us a limited licence to use those materials to provide the requested services.

You confirm that our authorised use of those materials will not infringe another person's rights.

---

## 37. Ownership of custom deliverables

Ownership of bespoke deliverables will be determined by the applicable Quote or project agreement.

Unless the Quote expressly states otherwise, payment for custom development does not transfer ownership of:

* CoSetup's pre-existing intellectual property;
* third-party software;
* open-source components;
* marketplace products incorporated into the solution;
* general-purpose components;
* reusable libraries;
* development tools; or
* know-how.

Where a Quote expressly provides that bespoke intellectual property will transfer to you, that transfer will normally take effect only after all amounts due for the relevant work have been paid in full.

---

## 38. Reusable knowledge and components

Unless otherwise agreed in writing, we remain free to use general skills, ideas, techniques, experience and non-customer-specific reusable components developed or learned while providing services.

We will not treat your confidential information or proprietary business data as a reusable component.

---

## 39. Open-source and third-party components

Software may incorporate open-source or third-party components.

Those components remain subject to their respective licences.

Nothing in these Terms transfers rights that we do not own or overrides applicable third-party or open-source licence conditions.

Where practical and relevant, significant dependencies may be identified in project documentation or source-code records.

---

# PART G — TECHNICAL SERVICES

## 40. Deployment and infrastructure services

CoSetup may provide services relating to:

* application deployment;
* servers;
* cloud infrastructure;
* domains;
* DNS;
* databases;
* containers;
* CI/CD;
* backups;
* monitoring;
* email;
* storage;
* CDN services;
* security configuration; and
* related infrastructure.

The exact service is determined by the relevant Quote or service description.

---

## 41. Third-party providers

Technical services may depend on third parties such as:

* hosting companies;
* cloud providers;
* domain registrars;
* payment providers;
* email providers;
* source-code hosts;
* API providers;
* SaaS platforms; and
* other infrastructure providers.

Their products and services are governed by their own terms.

We are not responsible for outages, policy changes, account suspensions, pricing changes or failures caused solely by a third-party provider outside our reasonable control, although we will remain responsible for our own obligations and for exercising reasonable care and skill in services we provide.

---

## 42. Third-party fees

Unless expressly included in a Quote, third-party costs such as hosting, domains, external APIs, licences, cloud usage and subscription fees are your responsibility.

We will not knowingly incur substantial unapproved third-party charges on your behalf unless the agreed service permits us to do so.

---

## 43. Credentials and access

Do not place passwords, private keys or sensitive production credentials in ordinary AI prompts or public messages.

Where credentials are required, use the secure method specified by CoSetup.

You are responsible for revoking or rotating credentials where reasonably appropriate after work is completed.

---

## 44. Backups

Unless backup management is expressly included in your service, you remain responsible for maintaining appropriate backups of production systems and data.

Before potentially destructive migration, deployment or maintenance work, the parties should establish appropriate backup arrangements.

We are not responsible for loss that results solely from a customer's failure to maintain a backup where we did not agree to provide backup services, subject always to liabilities that cannot legally be excluded.

---

## 45. Maintenance

Maintenance is provided only where expressly purchased or included.

Purchasing software from CoSetup does not automatically create an indefinite obligation for us to host, administer, update or maintain your installation.

---

# PART H — PLATFORM USE

## 46. Acceptable use

You must not use CoSetup to:

* break applicable law;
* infringe intellectual property rights;
* distribute malware;
* gain unauthorised access to systems;
* interfere with Platform operation;
* conduct denial-of-service attacks;
* probe or exploit vulnerabilities without written authorisation;
* scrape the Platform in a manner that materially harms its operation;
* impersonate another person;
* commit fraud;
* manipulate reviews;
* abuse payment or refund systems;
* circumvent licence controls;
* upload unlawful material; or
* facilitate activity that is unlawful in the jurisdiction applicable to you.

---

## 47. Uploaded material

You retain ownership of material you upload unless another agreement states otherwise.

You grant us the limited rights reasonably necessary to:

* store it;
* process it;
* display it to authorised users;
* analyse it where necessary to provide requested functionality;
* transmit it to relevant service providers or project participants; and
* otherwise use it to provide the service you requested.

You must have the right to provide any material you upload.

---

## 48. Source code and project files

Where you upload source code or proprietary project files for customisation, review or service delivery, we will treat them according to these Terms, our Privacy Policy and any applicable project-specific confidentiality terms.

You should not upload code or information that you are legally prohibited from disclosing.

---

## 49. Communications

CoSetup may provide messaging, project discussions, comments or similar communication features.

Communications connected with an order, project, quote, support request or dispute may be retained as part of the transaction or project record.

You must not use Platform communications for harassment, spam, fraud or unlawful activity.

---

## 50. Reviews and feedback

Where reviews are available, they must reflect genuine experiences.

We may moderate or remove reviews that:

* are fraudulent;
* contain unlawful material;
* contain personal or confidential information;
* are abusive or threatening;
* relate to an unrelated transaction; or
* are otherwise inconsistent with reasonable review guidelines.

We will not remove a genuine negative review merely because it is negative.

---

## 51. Platform availability

We aim to maintain reliable Platform availability but do not guarantee uninterrupted operation.

We may temporarily restrict access for:

* maintenance;
* upgrades;
* security incidents;
* infrastructure failures;
* legal requirements; or
* circumstances outside our reasonable control.

---

## 52. Changes to the Platform

We may improve, replace, add or discontinue Platform features.

Where a material change adversely affects an already purchased paid service, we will respect applicable contractual and statutory rights.

---

# PART I — SECURITY, SUSPENSION AND TERMINATION

## 53. Security

We may implement technical and organisational measures intended to protect the Platform, customers and vendors.

No internet-based system can be guaranteed completely secure.

You must take reasonable security precautions when using CoSetup.

---

## 54. Suspension

We may temporarily suspend an account, licence or service where reasonably necessary because of:

* suspected fraud;
* material security risk;
* unlawful use;
* serious breach of these Terms;
* non-payment;
* abuse of Platform infrastructure;
* infringement complaints;
* regulatory requirements; or
* protection of other users or systems.

Where reasonably possible, we will provide notice and an opportunity to resolve the issue.

Immediate suspension may occur where necessary to prevent harm, fraud, security compromise or unlawful activity.

---

## 55. Account closure

You may stop using CoSetup and request account closure subject to outstanding contractual obligations and records we are legally or legitimately required to retain.

Closing your account does not automatically:

* cancel outstanding invoices;
* terminate project obligations;
* reverse completed purchases;
* extinguish intellectual property licences already granted; or
* require deletion of records that we must lawfully retain.

---

## 56. Termination by us

We may terminate access where you materially breach these Terms and, where the breach can reasonably be remedied, fail to remedy it after reasonable notice.

We may terminate immediately for serious fraud, unlawful conduct, deliberate security attacks or similarly serious misuse.

Termination does not affect rights and obligations that arose before termination.

---

# PART J — WARRANTIES AND RESPONSIBILITY

## 57. Our responsibilities

We will provide services with the level of care and skill required by applicable law.

Where Consumer law applies, digital content and services carry statutory rights that are not excluded by these Terms.

---

## 58. Customer environment

Software may depend on specific versions of:

* programming languages;
* frameworks;
* databases;
* web servers;
* browsers;
* operating systems;
* extensions;
* third-party APIs; or
* other infrastructure.

Where requirements are clearly stated before purchase, you are responsible for ensuring that your intended environment meets those requirements unless you purchase setup or compatibility services from us.

---

## 59. Modifications by others

We are not responsible for defects caused solely by unauthorised or incompatible modifications made by you or another third party after delivery.

This does not affect responsibility for defects that existed before the modification and were not caused by it.

---

## 60. Business outcomes

Software and technical services are tools.

Unless expressly guaranteed in a written agreement, we do not guarantee that using a product or service will produce a particular:

* revenue;
* profit;
* customer volume;
* conversion rate;
* search ranking;
* investment return; or
* other commercial outcome.

---

# PART K — LIABILITY

## 61. Liability that is never excluded

Nothing in these Terms excludes or limits liability where doing so would be unlawful.

This includes liability for:

* death or personal injury caused by negligence;
* fraud or fraudulent misrepresentation; and
* any liability or statutory right that cannot legally be excluded or limited.

---

## 62. Consumers

If you are a Consumer, we are responsible for losses that are a foreseeable consequence of our breach of these Terms or failure to use reasonable care and skill, subject to applicable law.

We are not responsible for business losses suffered by a Consumer where the relevant product or service was obtained wholly or mainly for private use.

Your statutory consumer rights are unaffected.

---

## 63. Business Customers

This section applies only to Business Customers.

Subject to Section 61, we will not be liable for:

* loss of profits;
* loss of revenue;
* loss of business;
* loss of anticipated savings;
* loss of business opportunity;
* loss of goodwill; or
* indirect or consequential loss,

except to the extent such exclusion is prohibited by law.

Subject to Section 61 and any different limitation expressly agreed in a Quote or project contract, our aggregate liability arising from a particular product, service, project or event will not exceed the total amount paid or payable to us for the product, service or project giving rise to the claim during the 12 months preceding the event giving rise to liability.

Nothing in this section limits payment obligations owed to us.

---

## 64. Mitigation

Each party should take reasonable steps to reduce avoidable losses arising from a problem.

---

# PART L — CONFIDENTIALITY

## 65. Confidential information

During custom projects or technical services, either party may receive confidential business or technical information belonging to the other.

Each party agrees to use confidential information only for purposes connected with the relevant relationship and to protect it using reasonable care.

Confidential information does not include information that:

* is lawfully public;
* was already lawfully known without confidentiality obligations;
* is independently developed without use of the confidential information; or
* is lawfully received from another source without confidentiality restrictions.

---

## 66. Required disclosure

A party may disclose confidential information where required by law, court order or competent regulatory authority.

Where legally permitted, the affected party should be informed before disclosure.

---

# PART M — DATA PROTECTION

## 67. Privacy

Our processing of personal data is described in the **CoSetup Privacy Policy**.

Depending on how a service is used, CoSetup may process information relating to:

* accounts;
* organisations;
* purchases;
* payments;
* licensing;
* custom requests;
* project communications;
* uploaded files;
* vendor interactions;
* support;
* security;
* fraud prevention; and
* Platform usage.

---

## 68. Customer-controlled personal data

Where we process personal data contained in systems, databases or files supplied by a Business Customer solely to provide technical services on that customer's instructions, additional data-processing terms may apply.

Where legally required, the parties will enter into an appropriate Data Processing Agreement.

---

# PART N — COMPLAINTS AND DISPUTES

## 69. Contacting us about a problem

If something goes wrong, please contact CoSetup first and provide enough information for us to identify the relevant account, order, licence or project.

We will attempt to investigate complaints fairly and within a reasonable period.

---

## 70. Payment disputes

Before initiating a chargeback, we encourage you to contact us where practical so that we can investigate the issue.

Nothing in this provision removes any legal right to dispute an unauthorised or improper payment with your bank or payment provider.

---

## 71. Business disputes

If a dispute arises with a Business Customer, both parties agree to make reasonable efforts to resolve it through good-faith discussions before commencing court proceedings, except where urgent legal relief is reasonably necessary.

---

# PART O — OTHER LEGAL TERMS

## 72. Changes to these Terms

We may update these Terms from time to time.

The version applicable to a completed purchase or accepted Quote will generally be the version in force when the relevant contract was entered into, except where:

* a change is required by law;
* the parties agree otherwise; or
* a change relates only to future Platform use and does not retrospectively remove accrued rights.

Material changes affecting ongoing Platform use may be communicated through the Platform or by other reasonable means.

---

## 73. Transfer

You may not transfer your contractual rights or obligations to another person without our written consent where consent is reasonably required.

We may transfer our rights and obligations as part of a legitimate business reorganisation, merger, acquisition or transfer of the CoSetup business, provided this does not unlawfully reduce your rights.

Consumer rights concerning assignment remain unaffected.

---

## 74. No partnership or employment relationship

Using CoSetup does not create an employment relationship, partnership, joint venture or agency between you and Perfect Gateway LTD.

Independent vendors are not employees of the customer merely because work is facilitated through CoSetup.

---

## 75. Third-party rights

Unless expressly stated otherwise, a person who is not a party to a contract under these Terms does not have a right to enforce it.

---

## 76. Entire agreement — Business Customers

For Business Customers, these Terms together with the applicable order, Quote, Statement of Work and expressly incorporated documents constitute the agreement concerning the relevant transaction.

This provision does not exclude liability for fraud or fraudulent misrepresentation.

---

## 77. Severability

If a court or competent authority finds part of these Terms unlawful or unenforceable, the remaining provisions will continue to apply to the extent legally possible.

---

## 78. Waiver

If we do not immediately enforce a contractual right, that does not necessarily mean we have waived that right.

---

## 79. Events outside reasonable control

Neither party will be responsible for delay or failure caused by events outside its reasonable control to the extent permitted by law.

Such events may include major internet or infrastructure outages, natural disasters, war, civil disturbance, government action and widespread failures of essential third-party services.

This provision does not remove payment obligations for services already properly supplied.

---

## 80. Governing law

These Terms and contracts formed under them are governed by the laws of **England and Wales**, except that Consumers may retain the benefit of mandatory protections provided by the law applicable to them.

If you are a Consumer living in Scotland, Northern Ireland or another jurisdiction that gives you mandatory rights to bring proceedings locally, nothing in these Terms removes those rights.

---

## 81. Jurisdiction — Business Customers

For Business Customers, the courts of England and Wales will have exclusive jurisdiction over disputes arising from these Terms or contracts governed by them, unless a project-specific written agreement expressly provides otherwise.

---

## 82. Contact

Questions about these Terms, orders, licences, refunds, projects or complaints should be sent through the contact methods provided on CoSetup.

**Perfect Gateway LTD**
Trading as **CoSetup**
Website: **cosetup.net**

Additional registered-office, company-registration and contact information should be displayed here where required by applicable law.

---

# Summary

CoSetup exists to make acquiring and operating software simpler.

In practical terms:

**When you buy a product:** you are normally buying a licence, not its copyright.

**When a vendor created it:** Perfect Gateway LTD may still be the seller of record for your transaction.

**When you request custom work:** the accepted Quote defines what we have agreed to build or do.

**When the scope changes:** we agree the additional work rather than silently adding it to the original project.

**When you provide code or data:** you must have authority to provide it, and we use it to deliver the requested service.

**When something does not work as promised:** contact us so that it can be investigated and the appropriate repair, replacement, price reduction, refund or other remedy can be considered.

And nothing in these Terms is intended to take away statutory rights that applicable law says you must have.
`;
