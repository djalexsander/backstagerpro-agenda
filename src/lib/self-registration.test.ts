import { describe, expect, it } from "vitest";
import {
  getSelfRegistrationRedirectUrl,
  hashRegistrationIdentifier,
  isPendingSelfRegistration,
  validateSelfRegistrationInput,
} from "../../supabase/functions/_shared/self-registration";

const validBody = {
  nome_empresa: "Produtora Aurora",
  nome_responsavel: "Ana Souza",
  email: " ANA@EXAMPLE.COM ",
  telefone: "(11) 99999-0000",
  password: "senha-segura",
  website: "",
};

describe("secure self-registration", () => {
  it("normalizes a valid registration without weakening its password", () => {
    expect(validateSelfRegistrationInput(validBody)).toEqual({
      companyName: "Produtora Aurora",
      responsibleName: "Ana Souza",
      email: "ana@example.com",
      phone: "(11) 99999-0000",
      password: "senha-segura",
      honeypotFilled: false,
    });
  });

  it("rejects weak, oversized and malformed public input", () => {
    expect(() =>
      validateSelfRegistrationInput({ ...validBody, password: "1234567" }),
    ).toThrow(/8 e 128/i);
    expect(() =>
      validateSelfRegistrationInput({ ...validBody, email: "invalid" }),
    ).toThrow(/email inválido/i);
    expect(() =>
      validateSelfRegistrationInput({
        ...validBody,
        nome_empresa: "x".repeat(121),
      }),
    ).toThrow(/120 caracteres/i);
  });

  it("detects the anti-bot honeypot", () => {
    expect(
      validateSelfRegistrationInput({
        ...validBody,
        website: "https://spam.example",
      }).honeypotFilled,
    ).toBe(true);
  });

  it("allows resend only for an unconfirmed self-registration", () => {
    expect(
      isPendingSelfRegistration({
        email_confirmed_at: null,
        registration_source: "self_register",
      }),
    ).toBe(true);
    expect(
      isPendingSelfRegistration({
        email_confirmed_at: "2026-07-29T20:00:00Z",
        registration_source: "self_register",
      }),
    ).toBe(false);
    expect(
      isPendingSelfRegistration({
        email_confirmed_at: null,
        registration_source: "invite",
      }),
    ).toBe(false);
  });

  it("creates an HTTPS confirmation redirect and permits localhost", () => {
    expect(getSelfRegistrationRedirectUrl("https://agenda.example.com/app")).toBe(
      "https://agenda.example.com/escolher-plano",
    );
    expect(getSelfRegistrationRedirectUrl("http://localhost:8080")).toBe(
      "http://localhost:8080/escolher-plano",
    );
    expect(() =>
      getSelfRegistrationRedirectUrl("http://agenda.example.com"),
    ).toThrow(/HTTPS/i);
  });

  it("uses keyed, deterministic hashes without retaining the identifier", async () => {
    const secret = "a-secure-test-secret-with-more-than-32-characters";
    const first = await hashRegistrationIdentifier(
      "email:ana@example.com",
      secret,
    );
    const second = await hashRegistrationIdentifier(
      "email:ana@example.com",
      secret,
    );
    const other = await hashRegistrationIdentifier(
      "email:bia@example.com",
      secret,
    );

    expect(first).toHaveLength(64);
    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first).not.toContain("ana");
  });
});
