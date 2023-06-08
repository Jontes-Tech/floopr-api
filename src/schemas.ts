import { z } from "zod";
const validInstruments = [
  "other",
  "bass",
  "drums",
  "fx",
  "guitar",
  "keys",
  "orchestral",
  "vocals",
];
export const loopFormSchema = z
  .object({
    title: z.string({ required_error: "Title is required" }).min(1).max(64),
    author: z.string({ required_error: "Author is required" }).min(1).max(64),
    key: z.string({ required_error: "Key is required" }),
    tempo: z.number({
      required_error: "Tempo is required",
      invalid_type_error: "Tempo must be a number",
    }),
    timesig1: z
      .number({
        required_error: "Time signature is required",
        invalid_type_error: "Time signature must be a number",
      })
      .positive()
      .max(64),
    timesig2: z
      .number({
        required_error: "Time signature is required",
        invalid_type_error: "Time signature must be a number",
      })
      .max(64),
    submissionEmail: z
      .string({ required_error: "Email is required" })
      .email({
        message: "Email must be a valid email address",
      })
      .max(64),
    "cf-turnstile-response": z.string({
      required_error: "Captcha is required",
    }),
    instrument: z
      .string({ required_error: "Instrument is required" })
      .refine((instrument) => validInstruments.includes(instrument), {
        message: `Instrument must be one of the following: ${validInstruments.join(
          ", "
        )}`,
      }),
  })
  .strict();
