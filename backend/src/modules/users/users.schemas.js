const { z } = require('zod');
const { nonEmptyPatch, personName, phoneNumber } = require('../../utils/schemas');

// Email, password and status are changed through their own flows (OTP,
// password reset, admin), never through the profile.
const updateProfile = nonEmptyPatch(
  z.object({
    firstName: personName.optional(),
    lastName: personName.optional(),
    phone: phoneNumber.nullable().optional(),
    eventReminders: z.boolean().optional(), // Phase 18.2
  }),
);

module.exports = { updateProfile };
