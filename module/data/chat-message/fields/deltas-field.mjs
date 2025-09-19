import { formatNumber, getHumanReadableAttributeLabel } from "../../../utils.mjs";
import MappingField from "../../fields/mapping-field.mjs";

const { ArrayField, NumberField, ObjectField, SchemaField, StringField } = foundry.data.fields;

/**
 * @typedef ActorUpdatesDescription
 * @property {object} actor       Updates applied to the actor.
 * @property {object[]} [create]  Full data for Items to create (with IDs maintained).
 * @property {string[]} [delete]  IDs of items to be deleted from the actor.
 * @property {object[]} item      Updates applied to items on the actor.
 */

/**
 * @typedef ActorDeltasData
 * @property {IndividualDeltaData[]} actor                 Changes for the actor.
 * @property {string[]} [created]                          IDs of newly created items.
 * @property {object[]} [deleted]                          Saved data for deleted items.
 * @property {Record<string, IndividualDeltaData[]>} item  Changes for each item grouped by ID.
 */

/**
 * @typedef DeltaDisplayContext
 * @property {string} [delta]                        The formatted numeric change.
 * @property {Actor5e|Item5e} [document]             The document to which the delta applies.
 * @property {string} label                          The formatted label for the attribute.
 * @property {"create"|"delete"|"update"} operation  Type of update performed on the document.
 * @property {Roll[]} [rolls]                        Any rolls associated with the delta.
 * @property {string} type                           Type of document to which the delta applies.
 */

/**
 * A field for storing deltas made to an actor or embedded items.
 */
export class ActorDeltasField extends SchemaField {
  constructor() {
    super({
      actor: new ArrayField(new IndividualDeltaField()),
      created: new ArrayField(new StringField(), { required: false }),
      deleted: new ArrayField(new ObjectField(), { required: false }),
      item: new MappingField(new ArrayField(new IndividualDeltaField()))
    });
  }

  /* -------------------------------------------- */

  /**
   * Calculate delta information for an actor document from the given updates.
   * @param {Actor5e} actor                    Actor for which to calculate the deltas.
   * @param {ActorUpdatesDescription} updates  Updates to apply to the actor and contained items.
   * @returns {Partial<ActorDeltasData>}
   */
  static getDeltas(actor, updates) {
    const deltas = {
      actor: IndividualDeltaField.getDeltas(actor, updates.actor),
      created: updates.create?.length ? Array.from(updates.create) : null,
      deleted: updates.delete?.map(i => actor.items.get(i)?.toObject()).filter(_ => _),
      item: updates.item.reduce((obj, { _id, ...changes }) => {
        const deltas = IndividualDeltaField.getDeltas(actor.items.get(_id), changes);
        if ( deltas.length ) obj[_id] = deltas;
        return obj;
      }, {})
    };
    for ( const [k, v] of Object.entries(deltas) ) {
      if ( foundry.utils.isEmpty(v) ) delete deltas[k];
    }
    return deltas;
  }

  /* -------------------------------------------- */

  /**
   * Prepare deltas for display in a chat message.
   * @this {ActorDeltasData}
   * @param {Actor5e} actor   Actor to which this delta applies.
   * @param {Roll[]} [rolls]  Rolls that may be associated with a delta.
   * @returns {DeltaDisplayContext[]}
   */
  static processDeltas(actor, rolls=[]) {
    return [
      ...this.actor.map(d => IndividualDeltaField.processDelta.call(d, actor, rolls
        .filter(r => !r.options.delta?.item && (r.options.delta?.keyPath === d.keyPath)))),
      ...Object.entries(this.item).flatMap(([id, deltas]) =>
        deltas.map(d => IndividualDeltaField.processDelta.call(d, actor.items.get(id), rolls
          .filter(r => (r.options.delta?.item === id) && (r.options.delta?.keyPath === d.keyPath))))
      ),
      ...(this.created?.map(id => {
        const item = actor.items.get(id);
        return item ? { document: item, label: item.name, operation: "create", type: "item" } : null;
      }).filter(_ => _) ?? []),
      ...(this.deleted?.map(data => ({ label: data.name, operation: "delete", type: "item" })) ?? [])
    ];
  }
}

/**
 * @typedef IndividualDeltaData
 * @property {number} delta    The change in the specified field.
 * @property {string} keyPath  Path to the changed field on the document.
 */

/**
 * A field that stores a delta for an individual property on an actor or item.
 */
export class IndividualDeltaField extends SchemaField {
  constructor() {
    super({ delta: new NumberField(), keyPath: new StringField() });
  }

  /* -------------------------------------------- */

  /**
   * Calculate delta information for a document from the given updates.
   * @param {DataModel} dataModel      Document for which to calculate the deltas.
   * @param {object} updates           Updates that are to be applied.
   * @returns {IndividualDeltaData[]}
   */
  static getDeltas(dataModel, updates) {
    updates = foundry.utils.flattenObject(updates);
    const deltas = [];
    for ( const [keyPath, value] of Object.entries(updates) ) {
      let currentValue;
      if ( keyPath.startsWith("system.activities") ) {
        const [id, ...kp] = keyPath.slice(18).split(".");
        currentValue = foundry.utils.getProperty(dataModel.system.activities?.get(id) ?? {}, kp.join("."));
      }
      else currentValue = foundry.utils.getProperty(dataModel, keyPath);

      const delta = value - currentValue;
      if ( delta && !Number.isNaN(delta) ) deltas.push({ keyPath, delta });
    }
    return deltas;
  }

  /* -------------------------------------------- */

  /**
   * Prepare a delta for display in a chat message.
   * @this {IndividualDeltaData}
   * @param {Actor5e|Item5e} doc  Actor or item to which this delta applies.
   * @param {Roll[]} [rolls]      Rolls that may be associated with a delta.
   * @returns {DeltaDisplayContext}
   */
  static processDelta(doc, rolls=[]) {
    const type = doc instanceof Actor ? "actor" : "item";
    const value = this.keyPath.endsWith(".spent") ? -this.delta : this.delta;
    return {
      type,
      delta: formatNumber(value, { signDisplay: "always" }),
      document: doc,
      label: getHumanReadableAttributeLabel(this.keyPath, { [type]: doc }) ?? this.keyPath,
      operation: "update",
      rolls: rolls.map(roll => ({ roll, anchor: roll.toAnchor().outerHTML.replace(`${roll.total}</a>`, "</a>") }))
    };
  }
}
