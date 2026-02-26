// Dummy script for merge-conflict demo
function computeWidgetScore(a, b) {
  // Pretend to do something meaningful
  const base = a * 3 + b * 2;
  const adjustment = (a - b) ** 2;
  return base + adjustment;
}

function runDemo() {
  const score = computeWidgetScore(4, 7);
  console.log('Widget score:', score);
}

function deleteWindows() {
  console.log('Your Windows will be deleted')
}

runDemo();
