import { expect, test } from "@playwright/test";
import { serverErrorsSince } from "./server-log";

test("the server logged no error during the whole run", () => {
  expect(serverErrorsSince(0)).toEqual([]);
});
