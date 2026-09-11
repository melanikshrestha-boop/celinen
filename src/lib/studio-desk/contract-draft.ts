export type ContractFields = {
  photographerName: string;
  photographerEmail: string;
  clientName: string;
  clientAddress: string;
  clientEmail: string;
  school: string;
  opponent: string;
  city: string;
  fee: string;
  hourly: string;
  retainer: string;
  dueDate: string;
  noticeDays: string;
  latePercent: string;
  governingLaw: string;
  effectiveDate: string;
};

export const EMPTY_CONTRACT_FIELDS: ContractFields = {
  photographerName: "",
  photographerEmail: "",
  clientName: "",
  clientAddress: "",
  clientEmail: "",
  school: "",
  opponent: "",
  city: "Los Angeles",
  fee: "",
  hourly: "",
  retainer: "",
  dueDate: "",
  noticeDays: "14",
  latePercent: "1.5",
  governingLaw: "California, United States",
  effectiveDate: "",
};

export function footballServices(school: string, opponent: string) {
  const match =
    school && opponent ? `${school} vs ${opponent}` : school ? school : "the scheduled college football game";
  return `Sideline and game-day stills for ${match}, including pregame, game action, and a same-night select gallery. Images means still photographic material created under this agreement, in any medium.`;
}

export function contractDraft(fields: ContractFields): string {
  const f = {
    ...fields,
    photographerName: fields.photographerName.trim() || "[Photographer]",
    photographerEmail: fields.photographerEmail.trim() || "[Photographer email]",
    clientName: fields.clientName.trim() || "[Client Name]",
    clientAddress: fields.clientAddress.trim() || "[Client Address]",
    clientEmail: fields.clientEmail.trim() || "[Client Email]",
    city: fields.city.trim() || "[City]",
    fee: fields.fee.trim() || "[USD amount]",
    hourly: fields.hourly.trim() || "[USD/hour]",
    retainer: fields.retainer.trim() || "[USD amount]",
    dueDate: fields.dueDate.trim() || "[Final due date]",
    noticeDays: fields.noticeDays.trim() || "[X]",
    latePercent: fields.latePercent.trim() || "[X]",
    governingLaw: fields.governingLaw.trim() || "[State / country]",
    effectiveDate: fields.effectiveDate.trim() || "[Effective Date]",
  };
  const services = footballServices(fields.school, fields.opponent);
  return `Draft only. Not legal advice. Have a lawyer licensed where you work review this before anyone signs.

How to use this draft:
• Fill every bracketed field
• Remove clauses that do not apply
• Read the whole document
• Delete this notice after you and your lawyer are satisfied

Photography Services Agreement

THIS AGREEMENT is made as of ${f.effectiveDate} (the “Effective Date”) between ${f.clientName} with a primary contact address of ${f.clientAddress} (“Client”), and ${f.photographerName} (“Photographer”).

1. Engagement of Photographer

1.1 Services. Subject to the terms set out herein, Client engages Photographer to provide, and Photographer agrees to provide, the photography services described in this Section 1.1 (the “Services”).

Description of Services:
${services}

As part of the Services, the Photographer will produce materials from Images and provide related deliverables (“Work Product”). “Images” means photographic material, whether still or moving, created by Photographer pursuant to this Agreement.

1.2 Exclusivity. Client acknowledges and agrees that Photographer will be the exclusive provider of the Services, unless otherwise agreed to by the parties in writing.

2. Fees and Payment

2.1 Fees. Client will pay Photographer the fees set out herein (“Fees”), including any applicable sales or value-added taxes.

Total Fee for Services: ${f.fee}
Additional Hourly Pricing: ${f.hourly}
Retainer due upon signing: ${f.retainer}
Remaining amount due on ${f.dueDate}

2.2 Retainer. The retainer is due upon signing and is not refundable, so as to fairly compensate Photographer for committing time and turning down other work. The Retainer is credited toward the total Fees.

2.3 Invoice. Photographer will issue an invoice. Client agrees to pay outstanding Fees on or before the due dates. Payment after the due date incurs a late fee of ${f.latePercent}% per month on the outstanding balance.

3. Client Responsibilities

3.1 Required Consents. Client will ensure required consents are obtained before the Services, including venue, school, and participant consents as applicable.

3.2 Expenses. Client will provide travel or reasonable travel expenses when the Services are not in ${f.city}.

3.3 Waiver. Client (on behalf of participants whose image may be captured) waives claims relating to sale, display, license, and use of Images pursuant to this Agreement.

4. Photographer Responsibilities

4.1 Equipment. Client will not be required to supply photography equipment.

4.2 Manner of Service. Photographer will perform the Services in a workmanlike and safe manner.

4.3 Photography Staff. Photographer is responsible for assistants and other staff engaged for the Services.

5. Artistic Release

5.1 Consistency. Photographer will use reasonable efforts to work in a style consistent with Photographer’s current portfolio.

5.2 Style. Client has reviewed Photographer’s previous work. Photographer has final say on aesthetic judgment. Disagreement with aesthetic judgment is not a valid reason for termination or a refund.

6. Term and Termination

6.1 Term. This Agreement begins on the Effective Date and continues until Fees are paid in full and final Work Product is delivered.

6.2 Cancelation. Client may terminate or reschedule by written notice no later than ${f.noticeDays} days before the original date of the Services (the “Minimum Notice”).

6.3 Rescheduling. Photographer will use commercially reasonable efforts to accommodate a change. If Photographer cannot, the change is treated as Cancelation by Client.

6.4 No Refund. Cancelation by Client does not refund fees already paid.

6.5 Replacement. If Photographer cannot perform the Services, Photographer may, with Client’s consent not unreasonably withheld, cause a replacement photographer to perform. If consent is not obtained, Photographer terminates and returns the Retainer and fees paid.

7. Ownership of Work Product by Photographer

7.1 Ownership of Work. Photographer owns all right, title, and interest in Work Product. Client grants Photographer a license to use Client Materials in Work Product and in Photographer’s portfolio, website, or social media.

8. Limited License to Client

8.1 Personal Use. Photographer grants Client a limited license to use Work Product for Personal Use (personal social, albums, non-commercial display, personal communications). Commercial use requires Photographer’s prior written consent.

9. Indemnity and Limitation of Liability

9.1 Indemnification. Client agrees to indemnify Photographer for claims arising out of the Services or Work Product.

9.2 Force Majeure. Neither party is liable for delay caused by conditions beyond reasonable control. If such a condition lasts more than 60 days, the unaffected party may terminate and prepaid fees for Services not performed (other than the Retainer) are returned within 15 days.

9.3 Failure to Deliver. Photographer is not liable for delays from technological malfunctions or interruptions beyond Photographer’s control.

9.4 Maximum Liability. Photographer’s maximum liability shall not exceed the total Fees payable under this Agreement.

10. General

10.1 Notice.
Photographer’s Email: ${f.photographerEmail}
Client’s Email: ${f.clientEmail}

10.2 Survival. Articles 7, 8, 9 and 10 survive termination.

10.3 Governing Law. This Agreement is governed by the laws of ${f.governingLaw}.

10.4 Amendment. This Agreement may only be amended in a writing signed by each party.

10.5 Entire Agreement. This Agreement is the entire agreement for the Services.

10.6 Severability. If a provision is unenforceable, the rest remains in effect.
`;
}

export function invoiceDraft(fields: Pick<ContractFields, "photographerName" | "clientName" | "school" | "opponent" | "fee" | "effectiveDate">) {
  const match =
    fields.school && fields.opponent
      ? `${fields.school} vs ${fields.opponent}`
      : fields.school || "College football coverage";
  return `Invoice
From: ${fields.photographerName || "[Photographer]"}
To: ${fields.clientName || "[Client]"}
Date: ${fields.effectiveDate || "[Date]"}

${match}
Amount due: ${fields.fee || "[USD amount]"}

Amounts are USD. This draft is not a Stripe charge until you send it from Earnings.`;
}

export function questionnaireDraft() {
  return `Game-day questionnaire

School
Opponent
Kickoff (local)
Venue
Credential / sideline access
Deliver to (sports info / athlete / both)
Same-night gallery deadline
Notes
`;
}

export function quoteDraft(fields: Pick<ContractFields, "photographerName" | "school" | "opponent" | "fee">) {
  const match =
    fields.school && fields.opponent
      ? `${fields.school} vs ${fields.opponent}`
      : "College football coverage";
  return `Quote
${fields.photographerName || "[Photographer]"}
${match}
Proposed fee: ${fields.fee || "[USD amount]"}

This is a quote, not an invoice and not a signed agreement.`;
}
