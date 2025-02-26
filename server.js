
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
app.use(cors());


app.use(bodyParser.json());


const mongoURI = process.env.MONGO_URI;
mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true ,dbName:"appointmentBooking"});

const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", () => {
  console.log("Connected to MongoDB");
});


const doctorSchema = new mongoose.Schema({
  name: String,
  workingHours: {
    start: String, 
    end: String,   
  },
  specialization: String,
});

const Doctor = mongoose.model("Doctor", doctorSchema);


const appointmentSchema = new mongoose.Schema({
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" },
  date: Date,
  duration: Number, 
  appointmentType: String,
  patientName: String,
  notes: String,
});

const Appointment = mongoose.model("Appointment", appointmentSchema);


const calculateAvailableSlots = async (doctor, date) => {
    if (!date || isNaN(new Date(date).getTime())) {
        throw new Error("Invalid date. Use 'YYYY-MM-DD'.");
    }

    const workingStart = new Date(`${date}T${doctor.workingHours.start}:00Z`);
    const workingEnd = new Date(`${date}T${doctor.workingHours.end}:00Z`);

    if (isNaN(workingStart.getTime()) || isNaN(workingEnd.getTime())) {
        throw new Error("Invalid working hours or date.");
    }

    const appointments = await Appointment.find({
        doctorId: doctor._id,
        date: { $gte: workingStart, $lt: workingEnd },
    });

    let availableSlots = [];
    let currentTime = workingStart;

    while (currentTime < workingEnd) {
        const nextSlot = new Date(currentTime.getTime() + 30 * 60000);

        const isSlotTaken = appointments.some((appt) => {
            const apptStart = new Date(appt.date);
            const apptEnd = new Date(apptStart.getTime() + appt.duration * 60000);
            return currentTime < apptEnd && nextSlot > apptStart;
        });

        if (!isSlotTaken) {
            availableSlots.push(currentTime.toISOString()); 
        }

        currentTime = nextSlot;
    }

    return availableSlots;
};

  
  

// Routes
// Doctor Endpoints
app.get("/doctors", async (req, res) => {
  const doctors = await Doctor.find();
  res.json(doctors);
});

app.get("/doctors/:id/slots", async (req, res) => {
  const { id } = req.params;
  const { date } = req.query;
  const doctor = await Doctor.findById(id);

  if (!doctor) {
    return res.status(404).json({ error: "Doctor not found" });
  }

  const slots = await calculateAvailableSlots(doctor, date);
  res.json(slots);
});

// Appointment Endpoints
app.get("/appointments", async (req, res) => {
  const appointments = await Appointment.find().populate("doctorId");
  res.json(appointments);
});

app.get("/appointments/:id", async (req, res) => {
  const { id } = req.params;
  const appointment = await Appointment.findById(id).populate("doctorId");

  if (!appointment) {
    return res.status(404).json({ error: "Appointment not found" });
  }

  res.json(appointment);
});


app.post("/appointments", async (req, res) => {
  const { doctorId, date, duration, appointmentType, patientName, notes } = req.body;

  

  // Check for a valid date string in the request body
  if (!date || typeof date !== "string") {
    return res.status(400).json({ error: "Invalid or missing date field" });
  }

  let processedDate;

  try {
    // Sanitize the incoming date string to remove repeated segments
    const sanitizeDate = (incomingDate) => {
      try {
        // Remove repeated date fragments and any extra suffixes
        const match = incomingDate.match(
          /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/
        );
        if (match) {
          return match[1]; // Return the first valid match
        }
        throw new Error("Invalid date format");
      } catch (error) {
        console.error("Error sanitizing date:", incomingDate, error.message);
        return null;
      }
    };

    // Use the sanitization function
    const sanitizedDate = sanitizeDate(date);
    if (!sanitizedDate) {
      throw new Error("Sanitization failed");
    }

    // Parse the sanitized date
    const parsedDate = new Date(sanitizedDate);
    if (isNaN(parsedDate.getTime())) {
      throw new Error("Invalid time value");
    }

  
    processedDate = parsedDate.toISOString();
  } catch (error) {
    console.error("Error processing date:", date, error.message);
    return res.status(400).json({ error: `Invalid date format: ${date}` });
  }


  const doctor = await Doctor.findById(doctorId);
  if (!doctor) {
    return res.status(404).json({ error: `Doctor with ID ${doctorId} not found` });
  }

  const slots = await calculateAvailableSlots(doctor, processedDate.split("T")[0]);


  // Normalize and compare slots
  const normalizedSlots = slots.map((slot) => new Date(slot).toISOString());
  if (!normalizedSlots.includes(processedDate)) {
    return res.status(400).json({ error: "Time slot is not available" });
  }

  // Check for existing appointment
  const existingAppointment = await Appointment.findOne({ doctorId, date: processedDate });
  if (existingAppointment) {
    return res.status(400).json({ error: "Time slot is already booked" });
  }

  // Create and save the appointment
  const appointment = new Appointment({
    doctorId,
    date: processedDate,
    duration,
    appointmentType,
    patientName,
    notes,
  });

  await appointment.save();
  return res.status(201).json(appointment);
});



app.put("/appointments/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { date, duration } = req.body;

        // Validate input
        if (!date || isNaN(new Date(date).getTime())) {
            return res.status(400).json({ error: "Invalid or missing date" });
        }
        if (!duration || typeof duration !== "number") {
            return res.status(400).json({ error: "Invalid or missing duration" });
        }

        const appointment = await Appointment.findById(id);
        if (!appointment) {
            return res.status(404).json({ error: "Appointment not found" });
        }

        const doctor = await Doctor.findById(appointment.doctorId);
        if (!doctor) {
            return res.status(404).json({ error: "Doctor not found for the appointment" });
        }

        const slots = await calculateAvailableSlots(doctor, date.split("T")[0]);
        const requestedSlot = new Date(date).toISOString();

        if (!slots.includes(requestedSlot)) {
            return res.status(400).json({ error: "Time slot is not available" });
        }

        // Update appointment
        appointment.date = new Date(date);
        appointment.duration = duration;

        await appointment.save();
        res.json(appointment);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "An error occurred while updating the appointment" });
    }
});


app.delete("/appointments/:id", async (req, res) => {
  const { id } = req.params;
  await Appointment.findByIdAndDelete(id);
  res.status(204).send();
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
