# Fitness Tracker MVP: MVP refinement guidance

- The incline press bar weight is unknown (noted in the training plan). Seed it as a prompt on the
first incline press set rather than blocking the whole flow.
  - For simplicity, let's assume the bar is 10Kg. It is irrelevant, what matters is the increment over time. I Have updated the training plan with the full loaded bar weight.


## Open questions

Only decisions that depend on the user.

- Which weekdays are planned training days? Needed for skip detection.
  - This should not matter. I want to visualize done workouts in a simple form of calendar.

- The original request mentions "30 min workout, 45 min pause". 
  - The training plan specifies a single
  2:30 repeat. Is the 45 minute figure a second use case (rest between sessions?), or superseded?
  30+45 x 2 = 2:30. The rest time does not matter indeed. I just need a 1:15 timer that spins multiple times. I want to track the start of both A and B sets.

- Fractional loads: is 0.5 kg granularity enough, or is 0.25 kg needed? 
   - 0.5 is enough. Some weight increase by 2, some by 2.5, which is why i need the .5



