const targetDate = new Date("2026-07-02T00:00:00+03:00");
const startDate = new Date("2026-06-10T00:00:00+03:00");

const elements = {
  days: document.querySelector("#days"),
  hours: document.querySelector("#hours"),
  minutes: document.querySelector("#minutes"),
  seconds: document.querySelector("#seconds"),
  progress: document.querySelector("#progress"),
  percentage: document.querySelector("#percentage"),
  countdown: document.querySelector("#countdown-screen"),
  reveal: document.querySelector("#reveal-screen"),
  tracking: document.querySelector("#tracking-screen"),
  gpsStatus: document.querySelector("#gps-status"),
  distance: document.querySelector("#distance"),
  distanceUnit: document.querySelector("#distance-unit"),
  trackingMessage: document.querySelector("#tracking-message"),
  targetDot: document.querySelector("#target-dot"),
  directionArrow: document.querySelector("#direction-arrow"),
  directionArrowIcon: document.querySelector("#direction-arrow span"),
  turnHint: document.querySelector("#turn-hint"),
  headingBeam: document.querySelector("#heading-beam"),
  userBeacon: document.querySelector("#user-beacon"),
};

const pad = (value) => String(value).padStart(2, "0");
const searchStartedKey = "questSearchStarted";
const finishedKey = "questFinished";
const islandTarget = {
  latitude: 51.501221,
  longitude: 23.835152,
};
let watchId;
let locationPollId;
let locationAgeId;
let currentHeading = null;
let currentBearing = null;
let lastPosition = null;
let lastLocationUpdate = null;
let locationRequestPending = false;
let arrowRotation = 0;
let headingRotation = 0;
let simulatedArrival = false;
let targetLocation = islandTarget;
const forceFinish = new URLSearchParams(window.location.search).get("finish") === "1";
localStorage.removeItem("questTargetLocation");
localStorage.removeItem("questTargetVersion");

function setScreen(screenName) {
  ["countdown", "reveal", "tracking"].forEach((name) => {
    const isActive = name === screenName;
    elements[name].classList.toggle("is-active", isActive);
    elements[name].setAttribute("aria-hidden", String(!isActive));
  });
}

function updateCountdown() {
  const now = new Date();
  const remaining = targetDate - now;

  if (remaining <= 0) {
    if (elements.countdown.classList.contains("is-active")) {
      setScreen("reveal");
    }
    return;
  }

  const totalSeconds = Math.floor(remaining / 1000);
  elements.days.textContent = pad(Math.floor(totalSeconds / 86400));
  elements.hours.textContent = pad(Math.floor((totalSeconds % 86400) / 3600));
  elements.minutes.textContent = pad(Math.floor((totalSeconds % 3600) / 60));
  elements.seconds.textContent = pad(totalSeconds % 60);

  const totalDuration = targetDate - startDate;
  const elapsed = Math.max(0, now - startDate);
  const percentage = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
  elements.progress.style.width = `${percentage}%`;
  elements.percentage.textContent = `${Math.floor(percentage)}%`;
}

function destinationPoint(latitude, longitude, distance, bearing) {
  const earthRadius = 6371000;
  const angularDistance = distance / earthRadius;
  const bearingRadians = bearing * Math.PI / 180;
  const latitudeRadians = latitude * Math.PI / 180;
  const longitudeRadians = longitude * Math.PI / 180;

  const targetLatitude = Math.asin(
    Math.sin(latitudeRadians) * Math.cos(angularDistance)
      + Math.cos(latitudeRadians) * Math.sin(angularDistance) * Math.cos(bearingRadians),
  );
  const targetLongitude = longitudeRadians + Math.atan2(
    Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(latitudeRadians),
    Math.cos(angularDistance) - Math.sin(latitudeRadians) * Math.sin(targetLatitude),
  );

  return {
    latitude: targetLatitude * 180 / Math.PI,
    longitude: targetLongitude * 180 / Math.PI,
  };
}

function distanceAndBearing(from, to) {
  const earthRadius = 6371000;
  const lat1 = from.latitude * Math.PI / 180;
  const lat2 = to.latitude * Math.PI / 180;
  const deltaLat = (to.latitude - from.latitude) * Math.PI / 180;
  const deltaLon = (to.longitude - from.longitude) * Math.PI / 180;
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  const distance = earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

  return { distance, bearing };
}

function updatePosition(position) {
  if (lastPosition && position.timestamp <= lastPosition.timestamp) return;

  const current = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };

  const result = distanceAndBearing(current, targetLocation);
  const effectiveDistance = simulatedArrival ? 0 : result.distance;
  const isKilometers = effectiveDistance >= 1000;
  const displayDistance = isKilometers
    ? (effectiveDistance / 1000).toFixed(1)
    : effectiveDistance < 100
      ? effectiveDistance.toFixed(1)
      : Math.round(effectiveDistance);
  const radarDistance = Math.min(effectiveDistance, 100);
  const radius = (radarDistance / 100) * 46;
  currentBearing = result.bearing;
  const radians = (result.bearing - 90) * Math.PI / 180;

  elements.distance.textContent = displayDistance;
  elements.distanceUnit.textContent = isKilometers ? "км" : "м";
  elements.targetDot.style.left = `${50 + Math.cos(radians) * radius}%`;
  elements.targetDot.style.top = `${50 + Math.sin(radians) * radius}%`;
  updateCompass();
  const hasArrived = effectiveDistance <= 10;
  elements.tracking.classList.toggle("has-arrived", hasArrived);
  if (hasArrived) {
    localStorage.setItem(finishedKey, "1");
  }
  elements.trackingMessage.textContent = hasArrived
    ? "Знахідку підтверджено"
    : "Рухайся у напрямку стрілки";
  lastPosition = position;
  lastLocationUpdate = Date.now();
  updateLocationAge();
}

function updateLocationAge() {
  if (!lastPosition || !lastLocationUpdate) return;

  const age = Math.floor((Date.now() - lastLocationUpdate) / 1000);
  const accuracy = Math.round(lastPosition.coords.accuracy);
  elements.gpsStatus.textContent = age < 2
    ? `наживо · точність ±${accuracy} м`
    : `${age} с тому · точність ±${accuracy} м`;
}

function showFinishState() {
  setScreen("tracking");
  simulatedArrival = true;
  localStorage.setItem(searchStartedKey, "1");
  localStorage.setItem(finishedKey, "1");
  elements.distance.textContent = "0.0";
  elements.distanceUnit.textContent = "м";
  elements.gpsStatus.textContent = "фініш підтверджено";
  elements.tracking.classList.add("has-arrived");
  elements.trackingMessage.textContent = "Знахідку підтверджено";
  elements.targetDot.style.left = "50%";
  elements.targetDot.style.top = "50%";
}

function updateCompass() {
  if (currentBearing === null) return;

  const relativeBearing = currentHeading === null
    ? currentBearing
    : (currentBearing - currentHeading + 360) % 360;
  const signedTurn = relativeBearing > 180 ? relativeBearing - 360 : relativeBearing;
  const absoluteTurn = Math.abs(Math.round(signedTurn));

  arrowRotation += ((relativeBearing - arrowRotation + 540) % 360) - 180;
  headingRotation += (((currentHeading || 0) - headingRotation + 540) % 360) - 180;
  elements.directionArrowIcon.style.transform = `rotate(${arrowRotation}deg)`;
  elements.headingBeam.style.transform = `translate(-50%, -100%) rotate(${headingRotation}deg)`;
  elements.userBeacon.style.transform = `translate(-50%, -50%) rotate(${headingRotation}deg)`;

  if (currentHeading === null) {
    elements.turnHint.textContent = "напрямок за GPS";
  } else if (absoluteTurn <= 10) {
    elements.turnHint.textContent = "Повний вперед!!";
  } else {
    elements.turnHint.textContent = `поверни ${signedTurn > 0 ? "праворуч" : "ліворуч"} на ${absoluteTurn}°`;
  }
}

function handleOrientation(event) {
  const heading = event.webkitCompassHeading ?? (
    event.absolute && event.alpha !== null ? 360 - event.alpha : null
  );
  if (heading === null) return;

  currentHeading = heading;
  updateCompass();
}

async function startCompass() {
  if (!window.DeviceOrientationEvent) return;

  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    try {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== "granted") return;
    } catch {
      return;
    }
  }

  window.removeEventListener("deviceorientationabsolute", handleOrientation);
  window.removeEventListener("deviceorientation", handleOrientation);
  window.addEventListener("deviceorientationabsolute", handleOrientation, true);
  window.addEventListener("deviceorientation", handleOrientation, true);
}

function locationError(error) {
  if (error.code === 1) {
    elements.gpsStatus.textContent = "геолокацію заблоковано";
    elements.trackingMessage.textContent = "Дозволь геолокацію в налаштуваннях браузера";
    return;
  }

  if (lastPosition) {
    updateLocationAge();
    elements.trackingMessage.textContent = "GPS шукає свіжішу позицію";
    return;
  }

  elements.gpsStatus.textContent = "GPS шукає позицію";
  elements.trackingMessage.textContent = "Почекай трохи або вийди на відкрите місце";
}

function requestFreshPosition() {
  const hasFreshPosition = lastLocationUpdate && Date.now() - lastLocationUpdate < 12000;
  if (locationRequestPending || document.hidden || hasFreshPosition) return;
  locationRequestPending = true;

  navigator.geolocation.getCurrentPosition(
    (position) => {
      locationRequestPending = false;
      updatePosition(position);
    },
    (error) => {
      locationRequestPending = false;
      if (!lastPosition) locationError(error);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000,
    },
  );
}

async function startTracking() {
  setScreen("tracking");
  localStorage.setItem(searchStartedKey, "1");
  elements.gpsStatus.textContent = "пошук сигналу";
  await startCompass();

  if (!navigator.geolocation) {
    elements.trackingMessage.textContent = "Цей браузер не підтримує геолокацію";
    return;
  }

  if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(updatePosition, locationError, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 30000,
  });

  clearInterval(locationPollId);
  clearInterval(locationAgeId);
  setTimeout(requestFreshPosition, 5000);
  locationPollId = setInterval(requestFreshPosition, 10000);
  locationAgeId = setInterval(updateLocationAge, 1000);
}

document.querySelector("#show-final").addEventListener("click", () => setScreen("reveal"));
document.querySelector("#show-countdown").addEventListener("click", () => {
  localStorage.removeItem(searchStartedKey);
  setScreen("countdown");
});
document.querySelector("#start-tracking").addEventListener("click", startTracking);
document.querySelector("#show-reveal").addEventListener("click", () => {
  localStorage.removeItem(searchStartedKey);
  setScreen("reveal");
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && elements.tracking.classList.contains("is-active")) {
    startTracking();
  }
});

if (forceFinish || localStorage.getItem(finishedKey) === "1") {
  showFinishState();
} else if (localStorage.getItem(searchStartedKey) === "1") {
  startTracking();
} else {
  updateCountdown();
  setInterval(updateCountdown, 1000);
}
