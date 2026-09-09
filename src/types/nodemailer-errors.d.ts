/* nodemailer ships lib/errors.js but @types/nodemailer does not declare it.
   Declared here so the SMTP error codes can be derived from the library's own
   table instead of being copied into our source and drifting on upgrade. */
declare module "nodemailer/lib/errors.js" {
  export const ERROR_CODES: Record<string, string>;
}
