// Plain-language layer: turns UX jargon into words anyone on the team understands,
// while keeping the proper UX term visible alongside.

export const CAT_PLAIN = {
  feedback: { q: 'Does it respond when I act?', icon: '👆', why: 'Every click should give a visible sign that something happened.' },
  errors: { q: 'Does anything break?', icon: '🧯', why: 'Errors and failed requests make actions silently fail.' },
  efficiency: { q: 'Is it quick to use?', icon: '⚡', why: 'Easy-to-hit buttons and instant responses save effort.' },
  cognitive: { q: 'Is it easy to understand?', icon: '🧠', why: 'Fewer choices and less clutter means faster decisions.' },
  frustration: { q: 'Did people get stuck?', icon: '😤', why: 'Repeated clicking, hesitation and going back show confusion.' },
  forms: { q: 'Are forms easy to fill?', icon: '📝', why: 'Clear labels and inline help stop people giving up.' },
  accessibility: { q: 'Can everyone use it?', icon: '♿', why: 'Includes people with low vision, screen readers or keyboards only.' },
  consistency: { q: 'Does it feel familiar?', icon: '🧩', why: 'Things that look alike should behave alike and follow common patterns.' },
  hierarchy: { q: 'Is it easy to read?', icon: '👀', why: 'Clear titles, readable text and good structure help people scan.' },
  performance: { q: 'Is it fast?', icon: '🚀', why: 'Slow or jumpy pages feel broken and lose people.' },
  design: { q: 'Does it follow the design system?', icon: '📐', why: 'Using the shared colours, type and components keeps products consistent and cheaper to change.' },
};

export const SEV_PLAIN = {
  critical: { label: 'Blocker', desc: 'Stops or seriously hurts users', cls: 'critical' },
  major: { label: 'Frustrating', desc: 'Slows people down or confuses them', cls: 'major' },
  minor: { label: 'Polish', desc: 'Small improvement, adds up over time', cls: 'minor' },
};

export const EFFORT = { quick: '⚡ Quick fix', medium: '🛠 Moderate fix', large: '🏗 Bigger change' };

// [pattern on title, what people experience, effort]
const RULES = [
  [/Off-palette colour|close to a token|raw palette value|other colour mode|another brand/i, 'This colour isn’t one of the approved design-system colours, so it will drift from the brand and won’t update when the theme changes.', 'quick'],
  [/is not part of .*|not on the type scale|not in the system/i, 'This text style isn’t from the design system’s type scale, so headings and body text look inconsistent across screens.', 'quick'],
  [/off the spacing scale/i, 'This spacing is a one-off value instead of a step on the spacing scale, so layouts feel slightly uneven.', 'quick'],
  [/not a radius token/i, 'These corners don’t match the design system’s corner sizes.', 'quick'],
  [/Shadow does not match/i, 'This shadow isn’t one of the design system’s elevation styles.', 'quick'],
  [/doesn't follow the .* spec/i, 'This control looks different from the design-system component (size or corner shape), so it won’t feel like part of the same product.', 'medium'],
  [/Rage clicks/i, 'People clicked the same spot again and again — they expected something to happen and it didn’t (or it was too slow).', 'medium'],
  [/triggered a JavaScript error/i, 'Clicking this broke something behind the scenes, so the action probably failed without telling the user.', 'medium'],
  [/% of all clicks were dead/i, 'A large share of clicks did nothing. People can’t tell what is clickable and what isn’t.', 'medium'],
  [/Dead click/i, 'Clicking this did nothing visible, so people aren’t sure whether it worked.', 'quick'],
  [/JavaScript error/i, 'Something broke behind the scenes. Some features may not work.', 'medium'],
  [/console error/i, 'The page reported internal errors. Some features might not work as intended.', 'medium'],
  [/request failed|asset\(s\) failed/i, 'Some content or data didn’t load — people may see blank areas or broken images.', 'medium'],
  [/Hesitation/i, 'People paused over this for a long time, unsure what it does or what will happen.', 'quick'],
  [/Slow response/i, 'The screen took noticeably long to react after a click or key press.', 'medium'],
  [/scrolling back and forth/i, 'People scrolled up and down looking for something they couldn’t find.', 'medium'],
  [/Pogo-sticking|back-button/i, 'People kept going back — links didn’t lead where they expected.', 'medium'],
  [/native browser dialog/i, 'Plain browser pop-ups were used. They feel jarring and don’t explain consequences well.', 'quick'],
  [/Field friction|Long time on field/i, 'People struggled with this field — retyping, or not sure what to enter.', 'quick'],
  [/Form started but not submitted/i, 'Someone started filling a form and gave up before sending it.', 'large'],
  [/validation errors/i, 'People only found out about mistakes after pressing submit.', 'medium'],
  [/contrast/i, 'Some text is too faint against its background — hard to read for many people, and in bright light.', 'quick'],
  [/accessible name/i, 'Some buttons or links have no label, so screen-reader users just hear “button”.', 'quick'],
  [/alt attribute/i, 'Images have no description for people who can’t see them.', 'quick'],
  [/focus indicator/i, 'Keyboard users can’t see which element they’re on.', 'quick'],
  [/page language/i, 'The page doesn’t say what language it’s in, so screen readers may mispronounce it.', 'quick'],
  [/<main> landmark/i, 'Screen-reader users have no shortcut to jump to the main content.', 'quick'],
  [/autoplay/i, 'Sound starts playing on its own, which is startling and disruptive.', 'quick'],
  [/target\(s\) smaller/i, 'Some buttons and links are tiny and easy to miss — especially with a finger on a phone.', 'quick'],
  [/Navigation with/i, 'The menu offers a lot of options. More choices means slower decisions.', 'large'],
  [/interactive elements above the fold|buttons compete/i, 'The first screen is crowded — nothing stands out as the main thing to do.', 'medium'],
  [/text-heavy/i, 'There’s a lot of text. People skim, so important information gets missed.', 'medium'],
  [/No H1/i, 'There’s no clear main title telling people where they are.', 'quick'],
  [/H1 headings/i, 'Several “main titles” make it unclear what the page is about.', 'quick'],
  [/Heading levels skipped/i, 'Section titles are out of order, which confuses screen-reader navigation.', 'quick'],
  [/below 12 px/i, 'Some text is very small and hard to read.', 'quick'],
  [/Long line/i, 'Lines of text are very wide, which makes paragraphs tiring to read.', 'quick'],
  [/Horizontal scrolling/i, 'The page doesn’t fit the screen — people have to scroll sideways.', 'medium'],
  [/viewport meta/i, 'On phones the page will show up tiny and zoomed-out.', 'quick'],
  [/button styles/i, 'Buttons look different all over the page, so it’s unclear which is the main action.', 'medium'],
  [/font sizes|font families/i, 'Text styles are inconsistent, which makes the page feel less polished.', 'medium'],
  [/vague link/i, 'Links say things like “click here” instead of where they go.', 'quick'],
  [/new tab/i, 'Links open new tabs without warning, which breaks the Back button.', 'quick'],
  [/href="#"/i, 'Some “links” are really buttons in disguise and behave unpredictably.', 'medium'],
  [/without a label/i, 'Form fields have no visible label — the hint text disappears as soon as you start typing.', 'quick'],
  [/Long form/i, 'The form asks for a lot. Every extra field makes people more likely to give up.', 'large'],
  [/autocomplete/i, 'The browser can’t auto-fill details people have saved, so they retype them.', 'quick'],
  [/live regions/i, 'Success and error messages may not be read out to screen-reader users.', 'quick'],
  [/no search/i, 'There’s a lot of content but no search box to find things quickly.', 'large'],
  [/Large DOM/i, 'The page is very heavy, which can make it feel sluggish.', 'large'],
  [/without width\/height/i, 'The page jumps around as images load.', 'quick'],
  [/LCP/i, 'The main content takes too long to appear.', 'large'],
  [/CLS|Layout shift/i, 'Content jumps around while loading — people may click the wrong thing.', 'medium'],
  [/Interaction to Next Paint/i, 'The page feels laggy when you click or type.', 'large'],
  [/TTFB|server response/i, 'The server is slow to start sending the page.', 'large'],
  [/long tasks/i, 'The page briefly freezes while it’s busy.', 'large'],
  [/slow request/i, 'Some data took more than 2 seconds to arrive.', 'large'],
  [/Slow load/i, 'The page loads slowly with no sign that it’s working.', 'quick'],
];

export function plainFinding(f) {
  const r = RULES.find(([re]) => re.test(f.title));
  return { plain: r ? r[1] : f.detail, effort: r ? r[2] : 'medium' };
}

export function verdict(score) {
  if (score >= 90) return { word: 'Excellent', line: 'People should have a smooth, easy experience.', cls: 'g' };
  if (score >= 80) return { word: 'Good', line: 'Mostly smooth, with a few rough edges worth fixing.', cls: 'g' };
  if (score >= 70) return { word: 'Fair', line: 'Usable, but people will hit noticeable friction.', cls: 'o' };
  if (score >= 60) return { word: 'Needs work', line: 'Several issues will slow down or frustrate people.', cls: 'o' };
  return { word: 'Poor', line: 'People are likely to struggle or give up.', cls: 'b' };
}

export function status(score) {
  if (score == null) return { word: 'Not measured', cls: 'na' };
  if (score >= 90) return { word: 'Great', cls: 'g' };
  if (score >= 80) return { word: 'Good', cls: 'g' };
  if (score >= 60) return { word: 'Needs attention', cls: 'o' };
  return { word: 'Poor', cls: 'b' };
}

// Glossary: term, match regex (against principle text), plain definition, example
export const GLOSSARY = [
  ['Design system', /Design system|design token/i, 'A shared library of approved colours, fonts, spacing, corner sizes and components that teams build every screen from.', 'Echo UI, Material Design, Carbon.'],
  ['Design token', /Design system|token/i, 'A named design value, like “color/background/theme/primary” or “spacing/16”, used instead of typing a raw hex or pixel number.', 'Change the token once and every screen updates.'],
  ['Nielsen’s heuristics', /Nielsen/i, 'Ten widely used rules of thumb for usable interfaces, from usability expert Jakob Nielsen (e.g. “show system status”, “prevent errors”).', 'Used by UX teams worldwide as a checklist for reviews.'],
  ['Fitts’s Law', /Fitts/i, 'The bigger and closer a target is, the faster and easier it is to click or tap.', 'Tiny “×” close buttons are slow and error-prone.'],
  ['Hick’s Law', /Hick/i, 'The more options you give people, the longer it takes them to decide.', 'A menu with 20 items is slower to use than one with 6.'],
  ['Miller’s Law', /Miller/i, 'People can hold only about 7 (±2) things in their short-term memory at once.', 'Group long lists into smaller chunks.'],
  ['Jakob’s Law', /Jakob/i, 'People spend most of their time on other sites, so they expect yours to work the same way.', 'Logo top-left goes home; cart icon top-right.'],
  ['Tesler’s Law', /Tesler/i, 'Every task has some complexity that can’t be removed — the question is whether the user or the system carries it.', 'Auto-detecting a city from a postcode instead of asking for both.'],
  ['Doherty Threshold', /Doherty/i, 'People stay engaged when the system responds in under ~400 milliseconds.', 'Show a loading state immediately if a response will take longer.'],
  ['Von Restorff Effect', /Von Restorff/i, 'The item that looks different is the one people remember and notice.', 'Make the main call-to-action visually distinct.'],
  ['Goal-Gradient Effect', /Goal-Gradient/i, 'People speed up as they get closer to finishing — and give up if the end feels far away.', 'Progress bars on multi-step forms.'],
  ['Aesthetic-Usability Effect', /Aesthetic/i, 'People perceive good-looking, tidy designs as easier to use.', 'Consistent spacing and type make a product feel trustworthy.'],
  ['WCAG', /WCAG/i, 'Web Content Accessibility Guidelines — the international standard for making websites usable by people with disabilities. “AA” is the level most organisations must meet.', 'Text contrast of at least 4.5:1.'],
  ['Contrast ratio', /Contrast/i, 'How much text stands out from its background, from 1:1 (invisible) to 21:1 (black on white).', 'Light grey on white often fails.'],
  ['Affordance', /Affordance/i, 'Visual cues that tell people what they can do with something.', 'A raised button “says” press me; underlined text “says” I’m a link.'],
  ['Information scent', /Information scent|Information Foraging/i, 'How well link labels and cues hint at what people will find if they follow them.', '“Pricing” is a strong scent; “Click here” is none.'],
  ['Rage click', /rage/i, 'Clicking the same spot several times quickly — a sign of frustration.', 'Usually a slow or broken button.'],
  ['Dead click', /dead click/i, 'A click that produces no visible response.', 'Text that looks like a link but isn’t.'],
  ['Hesitation', /hesitation/i, 'Hovering over something for a long time without acting — a sign of uncertainty.', 'Two buttons with unclear differences.'],
  ['Pogo-sticking', /Pogo/i, 'Going into a page and straight back out repeatedly — the content didn’t match expectations.', ''],
  ['Core Web Vitals', /Core Web Vitals|LCP|CLS|INP/i, 'Google’s three key measures of real-world page experience: loading (LCP), visual stability (CLS) and responsiveness (INP).', ''],
  ['LCP', /LCP/i, 'Largest Contentful Paint — how long until the main content is visible. Good: under 2.5 seconds.', ''],
  ['CLS', /CLS/i, 'Cumulative Layout Shift — how much the page jumps around while loading. Good: under 0.1.', ''],
  ['INP', /INP/i, 'Interaction to Next Paint — how quickly the screen reacts after a click or key press. Good: under 200 ms.', ''],
  ['TTFB', /TTFB/i, 'Time to First Byte — how long the server takes to start responding. Good: under 800 ms.', ''],
  ['Above the fold', /fold/i, 'The part of a page visible without scrolling.', ''],
  ['Screen reader', /screen.reader|Name, Role|Non-text|Status Messages/i, 'Software that reads the screen aloud for people who are blind or have low vision.', ''],
];

export const termsFor = (text) => GLOSSARY.filter(([, re]) => re.test(text || '')).map(([t]) => t).slice(0, 3);
