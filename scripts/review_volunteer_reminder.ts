const response = await fetch("http://localhost:3000/dead-letters/review", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jobType: "volunteer_reminder",
    queue: "volunteer-reminders",
    failureCount: 2,
    correctionApplied: true,
    reviewId: "6157fe19-60c5-4dbc-ae60-a3d23f2a82be",
  }),
});

console.log(await response.json());

export {};
