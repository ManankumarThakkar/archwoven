// Tests simulate a configured deployment: the llm-not-configured gate (hosted
// mode without ANTHROPIC_API_KEY) must not 503 the hosted-mode suites.
// Tests that exercise the gate explicitly delete the key.
// Empty-string keys are exported by some shells/harnesses — treat unset and
// empty alike.
if (!(process.env.ANTHROPIC_API_KEY ?? '').trim()) process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-real-key';
