export const POLICY_DATE = "23 de octubre de 2026";
export const POLICY_LINKS = [
  { href: "/terms", label: "Términos y condiciones" },
  { href: "/privacy", label: "Privacidad" },
  { href: "/shipping", label: "Envíos y retiros" },
  { href: "/returns", label: "Cambios y devoluciones" },
  { href: "/arrepentimiento", label: "Botón de arrepentimiento" },
];

type Section = { title: string; paragraphs: string[] };
export const POLICIES: Record<
  "terms" | "privacy" | "shipping" | "returns" | "withdrawal",
  {
    title: string;
    intro: string;
    sections: Section[];
    form?: "WITHDRAWAL" | "EXCHANGE" | "PRIVACY";
  }
> = {
  terms: {
    title: "Términos y condiciones",
    intro: "Información para comprar en CHAIOBOUTIQUE y conocer cómo gestionamos cada pedido.",
    sections: [
      {
        title: "Quién vende",
        paragraphs: [
          "CHAIOBOUTIQUE es la tienda de moda femenina de Silvina Ivana Dani. Podés contactarnos en la sucursal de Embalse o por los medios publicados en esta página. Estos términos se aplican a las compras realizadas en esta tienda online.",
        ],
      },
      {
        title: "Productos, precios y disponibilidad",
        paragraphs: [
          "Cada ficha informa el artículo, su precio y las variantes disponibles. Los precios publicados corresponden a la moneda indicada en la tienda. El envío, cuando está disponible, se discrimina antes de confirmar el pedido. El total mostrado antes de pagar es el importe de la compra.",
          "La campaña editorial de la portada es una imagen de inspiración; para elegir una prenda consultá la ficha del producto. Ante dudas sobre medidas, composición o colores, consultanos antes de comprar.",
        ],
      },
      {
        title: "Pedido y pago",
        paragraphs: [
          "Al confirmar el pedido se registra una reserva temporal de stock. El plazo vigente se muestra en el detalle del pedido. Una reserva vencida libera las unidades y puede requerir iniciar una compra nueva.",
          "El pago se procesa en Mercado Pago. La tienda confirma el cobro consultando al proveedor; una captura de pantalla o el regreso del navegador no acreditan por sí solos un pago. Si hay una diferencia de importe o una aprobación tardía que requiere revisión, te contactaremos para resolverla. No vuelvas a pagar si el pedido indica revisión.",
        ],
      },
      {
        title: "Entrega y atención",
        paragraphs: [
          "La entrega se realiza mediante la opción elegida al comprar. Podés consultar sus condiciones en Envíos y retiros. Las solicitudes y reclamos se reciben por los medios de contacto publicados y por los formularios de la tienda.",
          "La creación de una cuenta es opcional para comprar. Debés informar datos correctos y mantener privados tu contraseña y el enlace de acceso al pedido.",
        ],
      },
      {
        title: "Tus derechos",
        paragraphs: [
          "Estos términos no limitan los derechos que reconocen la Ley 24.240 y las demás normas aplicables. El derecho de arrepentimiento, los reclamos por productos defectuosos y los cambios se explican en Cambios y devoluciones. Una modificación futura de estos términos no altera las condiciones de una compra ya realizada.",
        ],
      },
    ],
  },
  privacy: {
    title: "Política de privacidad",
    intro: "Usamos tus datos para atenderte, gestionar tus compras y proteger tu cuenta.",
    sections: [
      {
        title: "Responsable y datos que tratamos",
        paragraphs: [
          "La responsable de la tienda es Silvina Ivana Dani. Los medios para ejercer tus derechos están al final de esta página. Tratamos el nombre, email, teléfono, dirección de entrega, contenido del pedido, comprobantes y solicitudes que nos proporcionás. Si creás una cuenta, también se conserva la información necesaria para autenticarte y registrar tus preferencias y consentimientos.",
        ],
      },
      {
        title: "Para qué los usamos",
        paragraphs: [
          "Los datos se utilizan para registrar y entregar pedidos, informar pagos y novedades, atender devoluciones, emitir o registrar comprobantes y responder consultas. Los registros técnicos y de auditoría ayudan a prevenir abuso y a proteger la integridad de las operaciones.",
          "El consentimiento de comunicaciones comerciales es opcional y separado de la compra o del registro. Podés retirarlo por nuestros medios de contacto. No vendemos tus datos personales.",
        ],
      },
      {
        title: "Proveedores que intervienen",
        paragraphs: [
          "La tienda utiliza Vercel para alojamiento y Supabase para base de datos y archivos; el envío de correos se realiza mediante el proveedor de correo contratado por la tienda. Mercado Pago procesa los pagos en su propio entorno. Solo compartimos con transportistas o prestadores de entrega la información necesaria para cumplir el envío.",
          "Algunos prestadores pueden procesar datos fuera de Argentina. La tienda debe mantener las condiciones contractuales y de protección que correspondan a esos servicios. No almacenamos en nuestra base el número completo de tu tarjeta ni su código de seguridad.",
        ],
      },
      {
        title: "Cookies y conservación",
        paragraphs: [
          "Utilizamos cookies necesarias para la sesión y el carrito. No se incorporaron herramientas publicitarias o de analítica que requieran una elección adicional. Si se agregan, se informará su funcionamiento y se solicitará el consentimiento que corresponda.",
          "Conservamos los datos durante la gestión de la relación y los plazos necesarios para obligaciones legales, contables o reclamos. Los registros de ventas no se eliminan por una baja de cuenta cuando deban conservarse; se limita su uso a esas finalidades.",
        ],
      },
      {
        title: "Acceso, rectificación y supresión",
        paragraphs: [
          "Podés solicitar acceso, actualización, rectificación o supresión de tus datos y retirar consentimientos opcionales. Usá el formulario de esta página o nuestros medios de contacto. Podemos verificar tu identidad de forma razonable para evitar que otra persona acceda a tu información.",
          "La Agencia de Acceso a la Información Pública es la autoridad de control de la Ley 25.326 y recibe consultas y denuncias sobre protección de datos personales en argentina.gob.ar/aaip. El retiro de un consentimiento no afecta las operaciones realizadas legítimamente antes de tu solicitud.",
        ],
      },
    ],
    form: "PRIVACY",
  },
  shipping: {
    title: "Envíos y retiros",
    intro: "Elegí la forma de entrega disponible para tu pedido antes de pagar.",
    sections: [
      {
        title: "Retiro en Embalse",
        paragraphs: [
          "El retiro se realiza en Av. Pistarini 141, Embalse, Córdoba. Esperá la confirmación de que el pedido está listo antes de acercarte. Los horarios y la coordinación se confirman por nuestros medios de contacto. El retiro no tiene costo de envío.",
        ],
      },
      {
        title: "Envío a domicilio",
        paragraphs: [
          "El envío a domicilio se ofrece únicamente cuando la tienda tiene habilitada una tarifa y cobertura para tu destino. El costo se muestra por separado en el checkout. Informá dirección y datos de contacto completos.",
          "Los plazos y la cobertura informados por la tienda antes de la compra forman parte de las condiciones de entrega. Si no encontrás información suficiente para tu localidad, consultanos antes de pagar. No prometemos una fecha automática de entrega cuando depende de coordinación o del transportista.",
        ],
      },
      {
        title: "Preparación y seguimiento",
        paragraphs: [
          "El pedido se prepara una vez confirmado el pago. El detalle del pedido muestra su estado y, cuando se informa, el transportista y su seguimiento. Conservá el enlace privado que recibís al confirmar la compra.",
          "Si detectás un error en la dirección o una demora, contactanos con el número de pedido. Te informaremos cómo resolverlo, sin limitar los derechos que correspondan por incumplimiento de la entrega.",
        ],
      },
    ],
  },
  returns: {
    title: "Cambios y devoluciones",
    intro: "Queremos ayudarte a resolver un cambio, una devolución o un problema con tu compra.",
    sections: [
      {
        title: "Arrepentimiento de una compra a distancia",
        paragraphs: [
          "Podés revocar la aceptación dentro de los diez días corridos desde la entrega del producto o la celebración del contrato, lo que ocurra último, sin responsabilidad en los términos de la normativa aplicable. Podés usar el Botón de arrepentimiento sin crear una cuenta y sin tener que justificar tu decisión.",
          "Te entregamos una constancia con número de solicitud. Coordinaremos la puesta a disposición de la prenda y la devolución; los gastos de devolución por este derecho están a cargo de la tienda. No condicionamos este derecho a trámites presenciales ni a la aceptación de un crédito en la tienda.",
        ],
      },
      {
        title: "Productos con defectos o diferencias",
        paragraphs: [
          "Si recibiste un producto con un defecto, distinto al pedido o con una diferencia relevante respecto de lo ofrecido, comunicate para gestionar la solución que corresponda. Podés adjuntar la información útil durante la atención, pero no te pediremos datos completos de tarjetas ni contraseñas. Se respetan los derechos y garantías legales aplicables.",
        ],
      },
      {
        title: "Cambios por talle o color",
        paragraphs: [
          "Consultanos por disponibilidad para un cambio de talle o color. Cualquier condición comercial adicional debe informarse y acordarse sin reducir tus derechos legales. No se garantiza stock de otra variante hasta confirmar la disponibilidad.",
        ],
      },
      {
        title: "Reembolsos y devolución física",
        paragraphs: [
          "La solicitud, la devolución física de la prenda y el movimiento del dinero se registran por separado. Te informaremos la resolución y el medio del reembolso. El tiempo en que se vea acreditado puede depender del proveedor de pago. Una devolución de dinero no significa que una prenda ya haya vuelto al local.",
        ],
      },
    ],
    form: "EXCHANGE",
  },
  withdrawal: {
    title: "Botón de arrepentimiento",
    intro:
      "Solicitá la revocación de tu compra online. No necesitás iniciar sesión ni explicar el motivo.",
    sections: [
      {
        title: "Cómo funciona",
        paragraphs: [
          "Completá tus datos para que podamos responderte y, si lo tenés, el número de pedido. Al enviar recibís una constancia con código de solicitud. También enviamos la constancia al email informado. No cobramos por registrar la solicitud.",
          "Podés ejercer el derecho dentro de los diez días corridos desde la entrega o la celebración del contrato, lo último que ocurra, en los términos legales aplicables. Coordinaremos los pasos y los gastos de devolución a cargo de la tienda. Si el formulario falla, escribinos al WhatsApp publicado: tu solicitud también puede atenderse por ese medio.",
        ],
      },
    ],
    form: "WITHDRAWAL",
  },
};
