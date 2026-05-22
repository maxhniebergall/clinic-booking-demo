Build a booking experience for patients to find a physical thereapy or chioropractic 

The patient can
Find times that are available
Filter to specific type of care
Able to add notes on the visit

If two patients try to book the same slot, we use transactions to mitigate race conditions, we will suggest an alternative timeslot.

Must handle race conditions on booking with elegant conflict resolution, provide the next available booking as an alternative

Just local build, not focusing on system architecture, availability, throughput, latency, etc.

Concern about security & DDOS for adversarial actors without login.


--- 
Look like an actual clinic, inviting to a patient.

Demo a conflict
