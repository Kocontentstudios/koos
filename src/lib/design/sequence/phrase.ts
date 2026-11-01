/* Words a whole point never ends on: an article, a preposition, a
   conjunction or a verb still waiting for its object. A point that does
   ("Weekday bookings get a", once its offer was cut out for the action)
   is a sentence with a hole in it, and copy written from it keeps the
   hole ("come with a added to"). Articles are matched lowercase so a
   grade or a round ("Series A") is a name, not a cut. */
const CUT_WORD =
  /\b(?:and|or|nor|but|of|to|in|on|for|with|by|at|from|into|onto|through|across|within|without|between|among|towards?|via|per|than|no|not|get|gets|include|includes|offer|offers|give|gives|our|your|their|its)[.…]?$/i;
const CUT_ARTICLE = /\b(?:a|an|the)[.…]?$/;
/* A preposition whose object lost its noun: "every grid Lumora builds
   across rural." The adjective is left holding nothing. */
const CUT_MODIFIER =
  /\b(?:of|to|in|on|for|with|by|at|from|into|through|across|within|throughout|around|among|between|beyond|under|over)\s+(?:rural|urban|local|regional|national|global|digital|social|commercial|residential|industrial|agricultural|small|large|new|old|modern|traditional|remote|northern|southern|eastern|western|central|every|each|several)[.…!?]?$/i;

/** Whether `text` stops mid-phrase. */
export function stopsMidPhrase(text: string): boolean {
  const flat = text.trim();
  return (
    flat.length > 0 &&
    (CUT_WORD.test(flat) || CUT_ARTICLE.test(flat) || CUT_MODIFIER.test(flat))
  );
}
