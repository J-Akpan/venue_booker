import nodemailer from "nodemailer"
import { env } from "../../config/env"
import { logger } from "../../shared/logger"
import { enqueue, registerJob } from "../../shared/queue"
import { subscribe } from "../../shared/events"
import { getContact } from "../users"

interface EmailJob {
    to: string
    subject: string
    text: string
}

const transporter = env.email.user
    ? nodemailer.createTransport({
          host: "smtp.gmail.com",
          port: 587,
          secure: false,
          pool: true,
          connectionTimeout: 10_000,
          socketTimeout: 15_000,
          auth: { user: env.email.user, pass: env.email.pass },
      })
    : null

const sendEmail = async (job: EmailJob) => {
    if (!transporter) {
        logger.info({ to: job.to, subject: job.subject }, "EMAIL_USER not set, email not sent")
        return
    }
    await transporter.sendMail({ from: `"Venue Booker" <${env.email.user}>`, ...job })
}

const queueEmail = (job: EmailJob) => enqueue("email.send", job)

/**
 * Notifications is a pure subscriber: it reacts to domain events and nothing imports it, so
 * emails can be slow, retried or broken without ever affecting a booking or payment request.
 */
export const initNotifications = () => {
    registerJob("email.send", sendEmail)

    subscribe("user.registered", ({ email, username }) =>
        queueEmail({ to: email, subject: "Welcome to Venue Booker", text: `Hi ${username}, your account is ready.` }),
    )

    subscribe("user.passwordResetRequested", ({ email, otp }) =>
        queueEmail({ to: email, subject: "Your password reset code", text: `Your code is ${otp}. It is valid for 10 minutes. If you didn't request it, ignore this email.` }),
    )

    subscribe("booking.confirmed", async ({ userId, bookingId }) => {
        const contact = await getContact(userId)
        if (contact) await queueEmail({ to: contact.email, subject: "Booking confirmed", text: `Hi ${contact.name}, your booking ${bookingId} is confirmed.` })
    })

    subscribe("booking.cancelled", async ({ userId, bookingId, refund }) => {
        const contact = await getContact(userId)
        if (contact) {
            await queueEmail({
                to: contact.email,
                subject: "Booking cancelled",
                text: `Hi ${contact.name}, booking ${bookingId} was cancelled.${refund ? " Your payment will be refunded." : ""}`,
            })
        }
    })
}
