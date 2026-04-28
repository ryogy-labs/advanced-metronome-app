export function createTimeSignatureControls({
  buttons: { numUp, numDown, denUp, denDown },
  nums,
  dens,
  getValue,
  setValue,
}) {
  function stepNum(delta) {
    const { num, den } = getValue();
    const idx = nums.indexOf(num);
    const nextIdx = idx + delta;
    if (nextIdx >= 0 && nextIdx < nums.length) {
      setValue(nums[nextIdx], den);
    }
  }

  function stepDen(delta) {
    const { num, den } = getValue();
    const idx = dens.indexOf(den);
    const nextIdx = idx + delta;
    if (nextIdx >= 0 && nextIdx < dens.length) {
      setValue(num, dens[nextIdx]);
    }
  }

  numUp.addEventListener('click', () => stepNum(1));
  numDown.addEventListener('click', () => stepNum(-1));
  denUp.addEventListener('click', () => stepDen(1));
  denDown.addEventListener('click', () => stepDen(-1));
}
