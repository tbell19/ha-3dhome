/* Where the sun is, for daylight and shadows.
 */

/* Sun position (NOAA approximation, good to ~0.5°). Returns compass azimuth (0 = north, clockwise) and elevation, in degrees.
 * Only a fallback: HA's sun.sun already carries azimuth/elevation attributes. */
export function solarPosition(date: Date, lat: number, lon: number) {
  const rad = Math.PI / 180,
    d = date.getTime() / 86400000 + 2440587.5 - 2451545; // days since J2000
  const g = (357.529 + 0.98560028 * d) * rad,
    q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad,
    e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)),
    dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = (gmst * 15 + lon) * rad - ra,
    la = lat * rad;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(ha));
  return { azimuth: (((az / rad) % 360) + 360) % 360, elevation: el / rad };
}
/* Unit vector (Three.js X, Y, Z) pointing at the sun. `north` is how far north is turned clockwise from "up" on the
 * floor plan (towards the back wall, −y), in degrees: 0 = north is up, 90 = north is to the right. */
export function sunVector(azimuth: number, elevation: number, north = 0): [number, number, number] {
  const b = ((azimuth + (north || 0)) * Math.PI) / 180,
    e = (elevation * Math.PI) / 180;
  return [Math.sin(b) * Math.cos(e), Math.sin(e), -Math.cos(b) * Math.cos(e)];
}
