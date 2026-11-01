import nodemailer from "nodemailer"
import { env } from "../../config/env"
import { logger } from "../../shared/logger"
import { enqueue, registerJob } from "../../shared/queue"
import { subscribe } from "../../shared/events"
import { getContact } from "../users"
import { getVenueForBooking } from "../venues"

interface EmailJob {
    to: string
    subject: string
    text: string
}

interface WhatsAppJob {
    to: string
    message: string
}

const transporter = env.email.user
    ? nodemailer.createTransport({
          host: env.email.smtpHost,
          port: env.email.smtpPort,
          secure: env.email.smtpSecure,
          pool: true,
          connectionTimeout: 10_000,
          socketTimeout: 15_000,
          auth: { user: env.email.user, pass: env.email.pass },
      })
    : null

const sendEmail = async (job: EmailJob) => {
    if (!transporter) {
        logger.info({ subject: job.subject }, "SMTP credentials not set, email not sent")
        return
    }
    await transporter.sendMail({ from: env.email.from || `"Venue Booker" <${env.email.user}>`, ...job })
}

const queueEmail = (job: EmailJob) => enqueue("email.send", job)

const sendWhatsApp = async ({ to, message }: WhatsAppJob) => {
    if (!env.whatsapp.accessToken) return
    if (!/^\+[1-9]\d{7,14}$/.test(to)) {
        logger.warn("WhatsApp notification skipped because the saved phone number is not E.164")
        return
    }
    const response = await fetch(`https://graph.facebook.com/${env.whatsapp.graphApiVersion}/${env.whatsapp.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.whatsapp.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to.slice(1),
            type: "template",
            template: {
                name: env.whatsapp.bookingTemplate,
                language: { code: env.whatsapp.locale },
                components: [{ type: "body", parameters: [{ type: "text", text: message.slice(0, 900) }] }],
            },
        }),
        signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`WhatsApp Cloud API returned HTTP ${response.status}`)
}

const queueWhatsApp = (contact: Awaited<ReturnType<typeof getContact>>, message: string) => {
    if (!contact?.whatsappOptIn || !contact.phone || !env.whatsapp.accessToken) return
    return enqueue("whatsapp.send", { to: contact.phone, message })
}

/**
 * Notifications is a pure subscriber: it reacts to domain events and nothing imports it, so
 * emails can be slow, retried or broken without ever affecting a booking or payment request.
 */
export const initNotifications = () => {
    registerJob("email.send", sendEmail)
    registerJob("whatsapp.send", sendWhatsApp)

    subscribe("user.registered", ({ email, username }) =>
        queueEmail({ to: email, subject: "Welcome to Venue Booker", text: `Hi ${username}, your account is ready.` }),
    )

    subscribe("user.passwordResetRequested", ({ email, otp }) =>
        queueEmail({ to: email, subject: "Your password reset code", text: `Your code is ${otp}. It is valid for 10 minutes. If you didn't request it, ignore this email.` }),
    )

    subscribe("booking.confirmed", async ({ userId, bookingId }) => {
        const contact = await getContact(userId)
        if (contact) {
            const message = `Your booking ${bookingId} is confirmed.`
            await queueEmail({ to: contact.email, subject: "Booking confirmed", text: `Hi ${contact.name}, ${message}` })
            await queueWhatsApp(contact, message)
        }
    })

    subscribe("booking.created", async ({ venueId, bookingId }) => {
        const venue = await getVenueForBooking(venueId)
        const owner = await getContact(venue.ownerId)
        if (owner) {
            const message = `Booking request ${bookingId} is waiting for your response.`
            await queueEmail({ to: owner.email, subject: "New venue booking request", text: `Hi ${owner.name}, ${message}` })
            await queueWhatsApp(owner, message)
        }
    })

    subscribe("booking.accepted", async ({ userId, bookingId }) => {
        const contact = await getContact(userId)
        if (contact) {
            const message = `Booking request ${bookingId} was accepted. Complete payment before the hold expires.`
            await queueEmail({ to: contact.email, subject: "Your venue request was accepted", text: `Hi ${contact.name}, ${message}` })
            await queueWhatsApp(contact, message)
        }
    })

    subscribe("booking.declined", async ({ userId, bookingId, reason }) => {
        const contact = await getContact(userId)
        if (contact) {
            const message = `Booking request ${bookingId} was declined.${reason ? ` Reason: ${reason}` : ""}`
            await queueEmail({ to: contact.email, subject: "Your venue request was declined", text: `Hi ${contact.name}, ${message}` })
            await queueWhatsApp(contact, message)
        }
    })

    subscribe("case.resolved", async ({ raisedBy, caseId, type, outcome, resolution }) => {
        const contact = await getContact(raisedBy)
        if (contact) {
            await queueEmail({
                to: contact.email,
                subject: `Your ${type} has been ${outcome}`,
                text: `Hi ${contact.name}, your ${type} (${caseId}) was ${outcome}.\n\nResolution: ${resolution}`,
            })
            await queueWhatsApp(contact, `Your ${type} (${caseId}) was ${outcome}.`)
        }
    })

    subscribe("booking.cancelled", async ({ userId, bookingId, refundPercent }) => {
        const contact = await getContact(userId)
        if (contact) {
            await queueEmail({
                to: contact.email,
                subject: "Booking cancelled",
                text: `Hi ${contact.name}, booking ${bookingId} was cancelled.${refundPercent > 0 ? ` A ${refundPercent}% refund will be processed.` : " No refund is due under the cancellation terms."}`,
            })
            await queueWhatsApp(contact, `Booking ${bookingId} was cancelled. Refund: ${refundPercent}%.`)
        }
    })
}
