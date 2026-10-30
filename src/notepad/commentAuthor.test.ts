import { afterEach, describe, expect, it } from "vitest";
import {
  clearCommentAuthorProvider,
  commentAuthor,
  setCommentAuthorProvider,
} from "./commentAuthor";

afterEach(() => {
  clearCommentAuthorProvider();
});

describe("comment author", () => {
  it("falls back to \"You\" without a provider", () => {
    expect(commentAuthor()).toBe("You");
  });

  it("uses the injected provider (the plugin's settings)", () => {
    setCommentAuthorProvider(() => "Ann");
    expect(commentAuthor()).toBe("Ann");
  });

  it("an empty or whitespace name falls back to \"You\"", () => {
    setCommentAuthorProvider(() => "   ");
    expect(commentAuthor()).toBe("You");
  });

  it("trims the provided name", () => {
    setCommentAuthorProvider(() => "  Ann  ");
    expect(commentAuthor()).toBe("Ann");
  });
});
