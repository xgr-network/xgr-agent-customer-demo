export const SAMPLE_DOCUMENT_NAME = 'short-unstructured-insurance-letter.txt';

export function buildSampleDocumentText() {
  return [
    'Dear Maria Example,',
    '',
    'thank you for your message from last week. We checked your active health insurance contract and can confirm that everything is in good order.',
    '',
    'For your records: the contract we found is registered under the insurance number KV-123456789. Please use this number whenever you contact our support team about this case.',
    '',
    'This confirmation letter was created on 20 May 2026 and belongs to your current health insurance coverage with XGR Insurance GmbH.',
    '',
    'Kind regards,',
    'XGR Insurance GmbH',
  ].join('\n');
}

export function buildSampleDocumentBytes() {
  return Buffer.from(buildSampleDocumentText(), 'utf8');
}
