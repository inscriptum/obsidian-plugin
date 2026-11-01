import { describe, expect, it, beforeEach } from "vitest";
// Direct mock import: the mock Notice collects messages statically (the
// real obsidian.d.ts types have no such static).
import { Notice } from "../__mocks__/obsidian";

import {
  notifyBlockIdsRepaired,
  resetBlockIdNoticeDebounce,
} from "./blockIdFixNotice";

describe("notifyBlockIdsRepaired", () => {
  beforeEach(() => {
    Notice.messages.length = 0;
    resetBlockIdNoticeDebounce();
  });

  it("shows one restrained notice for the first repair", () => {
    notifyBlockIdsRepaired(3);
    expect(Notice.messages).toHaveLength(1);
    expect(Notice.messages[0]).toContain("3 block ids");
  });

  it("stays silent for follow-up repairs within the session window", () => {
    notifyBlockIdsRepaired(2);
    notifyBlockIdsRepaired(2);
    notifyBlockIdsRepaired(5);
    expect(Notice.messages).toHaveLength(1);
  });

  it("uses singular wording for a single repair", () => {
    notifyBlockIdsRepaired(1);
    expect(Notice.messages[0]).toContain("1 block id ");
  });
});
