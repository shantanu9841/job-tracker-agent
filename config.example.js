// config.js
// Replace this with your own profile context.
// This is what the agent uses to evaluate JD fit and draft outreach emails.

export const PROFILE_CONTEXT = `Your Name - Your Title (~X years experience)
Roles: Most recent role and company (what you did, key metrics), Previous role (what you did), Earlier role (what you did).
Skills: List your core skills here.
Education: Your degree, university.
Location: Your location (and remote preference).
Target: What roles you're looking for.`;

export const EMAIL_CONFIG = {
  senderName: "Your Name",
  // Add any style preferences for outreach emails
  maxWords: 200,
  tone: "professional but human",
};
