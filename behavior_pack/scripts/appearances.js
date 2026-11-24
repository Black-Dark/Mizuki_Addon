export const appearanceKey = "cc:appearance";

// The indices are saved on the entity and match the resource pack's render arrays.
export const appearances = [
  {
    icon: "mizuki", name: "Mizuki Todoroki", voice: "Mizuki", trait: "Gentle and dependable",
    greeting: "Hi again! I’ve got your back.",
    recalled: "Little Snowdrop, right here!",
    handedOver: "Here you go. I kept it all safe.",
    empty: "My bag’s empty. We can fill it together.",
    workPaused: "A little breather sounds nice. I can still pick things up and sort them.",
    workResumed: "I’ll pitch in when you mine, chop, or harvest nearby.",
    sortingPaused: "I’ll keep everything snug in my backpack.",
    sortingResumed: "I’ll put things where they belong."
  },
  {
    icon: "sora", name: "Sora Aizawa-Yamada", voice: "Sora", trait: "Curious and mischievous",
    canFly: true,
    greeting: "Tell me we’re going somewhere weird today.",
    recalled: "Found you! What did I miss?",
    handedOver: "Loot delivery! I only inspected the shiny ones.",
    empty: "Empty. A tragic shortage of shiny things.",
    workPaused: "Fine, the ores get a head start. I’ll still grab drops and sort.",
    workResumed: "Yes! Lead the way. I’ll grab the next ore, log, or crop.",
    sortingPaused: "My loot stays in my bag. Your loot. Our loot.",
    sortingResumed: "Okay, shiny stuff goes in the right chests. Mostly kidding."
  },
  {
    icon: "yukishiro", name: "Yukishiro Renka Aizawa", voice: "Yukishiro", trait: "Shy, sleepy, and affectionate",
    greeting: "Oh… hi. Is it okay if I stay close?",
    recalled: "I’m here… you can put the whistle away now.",
    handedOver: "Here. I was saving these for you.",
    empty: "I, um… don’t have anything with me right now.",
    workPaused: "A rest? Okay. I’ll still pick up and sort what we find.",
    workResumed: "I’m awake. I’ll help with the next ore, log, or crop.",
    sortingPaused: "I’ll hold onto everything here, if that’s okay.",
    sortingResumed: "Okay. I’ll put our things away quietly."
  },
  {
    icon: "shion", name: "Shion Veyr Clive", voice: "Shion", trait: "Perceptive and quietly sarcastic",
    greeting: "I’ve surveyed the area. The dirt is exactly where we left it.",
    recalled: "You called. I assume the dirt has put up a fight.",
    handedOver: "Your supplies. I trust you’ll use better judgment than the last chest did.",
    empty: "Empty. A rare example of inventory management going exactly to plan.",
    workPaused: "Very well. I’ll handle loose items and sorting while the ore recovers.",
    workResumed: "I’ll take the next nearby ore, log, or crop. Try to contain your excitement.",
    sortingPaused: "The chest may rest. I’ll retain the supplies.",
    sortingResumed: "I’ll restore order. The chests set a low bar."
  },
  {
    icon: "lucien", name: "Lucien Aurelius Morningstar", voice: "Lucien", trait: "Sophisticated and diplomatic",
    greeting: "A pleasure. Where shall we turn our attention today?",
    recalled: "At your side, as requested.",
    handedOver: "Your supplies, in good order.",
    empty: "I’m afraid I have no supplies to offer at present.",
    workPaused: "Of course. I’ll continue gathering loose items and attending to storage.",
    workResumed: "You may leave nearby ore, timber, and crops to me.",
    sortingPaused: "I’ll keep everything in my care until you say otherwise.",
    sortingResumed: "I’ll see to it that each item reaches its proper chest."
  },
  {
    icon: "naoki", name: "Naoki Aizawa-Yamada", voice: "Naoki", trait: "Quiet, sharp, and dryly caring",
    greeting: "Hey. I’ve got the bag. Go do your thing.",
    recalled: "Here. You could’ve just said my name.",
    handedOver: "Take these. I carried them for a reason.",
    empty: "Nothing in the bag. I checked twice.",
    workPaused: "Got it. I’ll stick to drops and chests.",
    workResumed: "Back on ore, logs, and crops. Just do your thing.",
    sortingPaused: "Everything stays with me. I can handle it.",
    sortingResumed: "I’ll do the chests. Go on."
  }
];

export function appearanceOf(companion) {
  return appearances[companion?.getProperty(appearanceKey)] ?? appearances[0];
}
