// Inline-SVG fallbacks for AWS service icons removed from Simple Icons v15.0.0.
// Source: simpleicons.org/icons removed under brand-owner permission review.
// These are simplified brand-colored glyphs for the affected slugs so diagrams
// don't render with broken images. Phase 2 (diagramify-icons repo) replaces
// these with the official AWS Architecture Icons hosted on our R2 bucket.

const SVG = (color: string, path: string) =>
  `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="${color}" d="${path}"/></svg>`;

const AWS_ORANGE = '#ff9900';
const AWS_BLUE = '#527fff';
const AWS_GREEN = '#569a31';
const AWS_PURPLE = '#8c4fff';
const AWS_RED = '#dd344c';

const SHIELD = 'M12 2L3 7v6c0 5 3.8 9.4 9 10 5.2-.6 9-5 9-10V7l-9-5zm0 2.18l7 3.89V13c0 4-3 7.8-7 8.46-4-.66-7-4.46-7-8.46V8.07l7-3.89z';
const CUBE = 'M12 2L4 6v12l8 4 8-4V6l-8-4zm0 2.31L17.69 7 12 9.69 6.31 7 12 4.31zM5.5 8.41l5.75 2.68v8.5L5.5 16.81V8.41zm7.25 11.18v-8.5L18.5 8.41v8.4l-5.75 2.78z';
const LIGHTNING = 'M6 3h3.5l8.5 18H14.5L6 3zm10 0h2v6.5l-3-6.5h1zm-10 18H4l3-6.5L8.5 18 6 21z';
const DATABASE = 'M12 2C7.58 2 4 3.34 4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5c0-1.66-3.58-3-8-3zm0 2c4.42 0 6 1.34 6 2s-1.58 2-6 2-6-1.34-6-2 1.58-2 6-2zM6 8.04C7.55 8.65 9.66 9 12 9s4.45-.35 6-.96V12c0 .66-1.58 2-6 2s-6-1.34-6-2V8.04zM6 14.04C7.55 14.65 9.66 15 12 15s4.45-.35 6-.96V19c0 .66-1.58 2-6 2s-6-1.34-6-2v-4.96z';
const BUCKET = 'M5 3h14l-1.5 17a2 2 0 01-2 2h-7a2 2 0 01-2-2L5 3zm2.18 2l1.32 15a.5.5 0 00.5.45h6a.5.5 0 00.5-.45L16.82 5H7.18z';
const ENVELOPE = 'M3 5h18v14H3V5zm2 2v.5l7 4.5 7-4.5V7H5zm0 2.5V17h14V9.5l-7 4.5-7-4.5z';
const QUEUE = 'M3 6h18v3H3V6zm0 4.5h18v3H3v-3zm0 4.5h18v3H3v-3z';
const FLOW = 'M3 7l9 5 9-5v3l-9 5-9-5V7zm0 7l9 5 9-5v3l-9 5-9-5v-3z';
const EYE = 'M12 5c-5 0-9 4-10 7 1 3 5 7 10 7s9-4 10-7c-1-3-5-7-10-7zm0 11a4 4 0 110-8 4 4 0 010 8zm0-2a2 2 0 100-4 2 2 0 000 4z';
const LOCK = 'M12 1a5 5 0 015 5v3h2v13H5V9h2V6a5 5 0 015-5zm0 2a3 3 0 00-3 3v3h6V6a3 3 0 00-3-3zm-5 8v9h10v-9H7zm5 2a2 2 0 012 2v1h-4v-1a2 2 0 012-2z';
const GLOBE = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.94-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3a1 1 0 00-1-1H8v-2h2a1 1 0 001-1V7h2a2 2 0 002-2v-.41a7.984 7.984 0 013.9 12.8z';

export const AWS_INLINE_SVG: Record<string, string> = {
  amazoncloudfront: SVG(AWS_PURPLE, SHIELD),
  awslambda: SVG(AWS_ORANGE, LIGHTNING),
  amazons3: SVG(AWS_GREEN, BUCKET),
  amazonrds: SVG(AWS_BLUE, DATABASE),
  amazondynamodb: SVG(AWS_BLUE, DATABASE),
  amazonaurora: SVG(AWS_BLUE, DATABASE),
  amazonsqs: SVG(AWS_ORANGE, QUEUE),
  amazonsns: SVG(AWS_ORANGE, ENVELOPE),
  amazonses: SVG(AWS_BLUE, ENVELOPE),
  amazonec2: SVG(AWS_ORANGE, CUBE),
  amazonecs: SVG(AWS_ORANGE, CUBE),
  amazoneks: SVG(AWS_ORANGE, CUBE),
  amazonkinesis: SVG(AWS_PURPLE, FLOW),
  amazoncloudwatch: SVG(AWS_RED, EYE),
  amazoncloudtrail: SVG(AWS_RED, EYE),
  amazonroute53: SVG(AWS_PURPLE, GLOBE),
  amazonvpc: SVG(AWS_PURPLE, GLOBE),
  amazonelb: SVG(AWS_PURPLE, FLOW),
  amazonqldb: SVG(AWS_BLUE, DATABASE),
  amazonbedrock: SVG(AWS_GREEN, SHIELD),
  amazonsagemaker: SVG(AWS_GREEN, SHIELD),
  amazonecr: SVG(AWS_BLUE, CUBE),
  amazondevicefarm: SVG(AWS_BLUE, CUBE),
  awsfargate: SVG(AWS_ORANGE, CUBE),
  awsamplify: SVG(AWS_ORANGE, LIGHTNING),
  awssecretsmanager: SVG(AWS_RED, LOCK),
  awscertificatemanager: SVG(AWS_RED, LOCK),
  awsiam: SVG(AWS_RED, LOCK),
  awsappconfig: SVG(AWS_BLUE, CUBE),
  awsappsync: SVG(AWS_BLUE, FLOW),
  awsstepfunctions: SVG(AWS_PURPLE, FLOW),
  awssystemsmanager: SVG(AWS_BLUE, CUBE),
  awscodebuild: SVG(AWS_BLUE, CUBE),
  awscodedeploy: SVG(AWS_BLUE, FLOW),
  awscodepipeline: SVG(AWS_BLUE, FLOW),
  awscodecommit: SVG(AWS_BLUE, CUBE),
  amazonapigateway: SVG(AWS_RED, FLOW),
};
