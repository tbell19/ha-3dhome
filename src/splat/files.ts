/* Asking for a file: a hidden file input, clicked. `capture` opens the phone's camera app to make one (a video, for a
 * scan), which works on http pages too, where the page can't use the camera itself. */
export function pickFile(accept: string, then: (f: File) => void, capture?: "environment") {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  if (capture) input.setAttribute("capture", capture);
  input.onchange = () => input.files?.[0] && then(input.files[0]);
  input.click();
}
