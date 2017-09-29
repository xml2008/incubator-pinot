/**
 * Handles alert form creation settings
 * @module self-serve/create/controller
 * @exports create
 */
import fetch from 'fetch';
import Ember from 'ember';
import _ from 'lodash';
import { checkStatus } from 'thirdeye-frontend/helpers/utils';

export default Ember.Controller.extend({

  /**
   * Default text value for the anomaly graph legend
   */
  legendText: {
    dotted: {
      text: 'WoW'
    },
    solid: {
      text: 'Observed'
    }
  },

  /**
   * Array to define alerts table columns for selected config group
   */
  alertsTableColumns: [
    {
      propertyName: 'id',
      title: 'Id',
      className: 'te-form__table-index'
    },
    {
      propertyName: 'name',
      title: 'Alert Name'
    },
    {
      propertyName: 'metric',
      title: 'Alert Metric',
      className: 'te-form__table-metric'
    },
    {
      propertyName: 'type',
      title: 'Alert Type'
    }
  ],

  /**
   * Important initializations
   */
  isEmailError: false, // are new email addresses formatted ok
  isDuplicateEmail: false, // is email entered already in DB
  isEditedConfigGroup: false, // were props changed by user
  isNewConfigGroup: false, // was a new group selected
  alertGroupNewRecipient: null, // ensure last entry cleared
  newConfigGroupName: null,  // ensure last entry cleared
  isEditAlertError: false, // alert save failure
  isEditAlertSuccess: false, // alert save success
  isNewConfigGroupSaved: false, // to trigger end-of-process cues
  isProcessingForm: false, // to trigger submit disable
  updatedRecipients: [], // placeholder for all email recipients

  /**
   * Properties from model, using 'reads' so that changes are cancellable
   */
  metricData: Ember.computed.reads('model.metricData'),
  alertDimension: Ember.computed.reads('model.function.exploreDimensions'),
  metricDimensions: Ember.computed.reads('model.metricDimensions'),
  metricName: Ember.computed.reads('model.function.metric'),
  granularity: Ember.computed.reads('model.function.bucketUnit'),
  alertFilters: Ember.computed.reads('model.function.filters'),
  alertConfigGroups: Ember.computed.reads('model.allConfigGroups'),
  alertFunctionName: Ember.computed.reads('model.function.functionName'),
  alertId: Ember.computed.reads('model.function.id'),
  isActive: Ember.computed.reads('model.function.isActive'),
  allApplications: Ember.computed.reads('model.allApps'),
  selectedConfigGroup: Ember.computed.reads('model.originalConfigGroup'),
  selectedAppName: Ember.computed.reads('model.selectedAppName'),
  isLoadError: Ember.computed.reads('model.loadError'),
  loadErrorMessage: Ember.computed.reads('model.loadErrorMsg'),

  /**
   * Returns the list of existing config groups and updates it if a new one is added.
   * @method allAlertsConfigGroups
   * @return {Array} list of existing config groups
   */
  allAlertsConfigGroups: Ember.computed(
    'isNewConfigGroupSaved',
    'alertConfigGroups',
    'newConfigGroupObj',
    function() {
      const groupsFromModel = this.get('alertConfigGroups');
      if (this.get('isNewConfigGroupSaved')) {
        return groupsFromModel.concat(this.get('newConfigGroupObj'));
      } else {
        return groupsFromModel;
      }
    }
  ),

  /**
   * If a dimension has been selected, the metric data object will contain subdimensions.
   * This method calls for dimension ranking by metric, filters for the selected dimension,
   * and returns a sorted list of graph-ready dimension objects.
   * @method getTopDimensions
   * @return {Array} dimensionList: array of graphable dimensions
   */
  topDimensions: Ember.computed(
    'metricDimensions',
    'alertDimension',
    'metricData',
    function() {
      const maxSize = 5;
      const selectedDimension = this.get('alertDimension');
      const scoredDimensions = this.get('metricDimensions');
      const colors = ['orange', 'teal', 'purple', 'red', 'green', 'pink'];
      const dimensionObj = this.get('metricData.subDimensionContributionMap') || {};
      const filteredDimensions =  _.filter(scoredDimensions, function(dimension) {
        return dimension.label.split('=')[0] === selectedDimension;
      });
      const topDimensions = filteredDimensions.sortBy('score').reverse().slice(0, maxSize);
      const topDimensionLabels = [...new Set(topDimensions.map(key => key.label.split('=')[1]))];
      let dimensionList = [];
      let colorIndex = 0;

      // Build the array of subdimension objects for the selected dimension
      for(let subDimension of topDimensionLabels){
        if (dimensionObj[subDimension] && subDimension !== '') {
          dimensionList.push({
            name: subDimension,
            metricName: subDimension,
            color: colors[colorIndex],
            baselineValues: dimensionObj[subDimension].baselineValues,
            currentValues: dimensionObj[subDimension].currentValues,
          });
          colorIndex++;
        }
      }

      // Return sorted list of dimension objects
      return dimensionList;
    }
  ),

  /**
   * Returns the appropriate subtitle for selected config group monitored alerts
   * @method selectedConfigGroupSubtitle
   * @return {String} title of expandable section for selected config group
   */
  selectedConfigGroupSubtitle: Ember.computed(
    'selectedConfigGroup',
    function () {
      return `Alerts Monitored by: ${this.get('selectedConfigGroup.name')}`;
    }
  ),

  /**
   * Mapping alertFilter's pattern to human readable strings
   * @returns {String}
   */
  pattern: Ember.computed('alertFilter.pattern', function() {
    const pattern = this.getWithDefault('alertFilter.pattern', 'UP,DOWN');

    const patternMapping = {
      'UP,DOWN': 'Up and Down',
      UP: 'Up only',
      DOWN: 'Down Only'
    };

    return patternMapping[pattern];
  }),

  /**
   * Extracting Weekly Effect from alert Filter
   * @returns {String}
   */
  weeklyEffect: Ember.computed('alertFilter.weeklyEffectModeled', function() {
    const weeklyEffect = this.getWithDefault('alertFilter.weeklyEffectModeled', true);

    return weeklyEffect;
  }),

  /**
   * Extracting sensitivity from alert Filter and maps it to human readable values
   * @returns {String}
   */
  sensitivity: Ember.computed('alertFilter.userDefinedPattern', function() {
    const sensitivity = this.getWithDefault('alertFilter.userDefinedPattern', 'MEDIUM');
    const sensitivityMapping = {
      LOW: 'Robust',
      MEDIUM: 'Medium',
      HIGHT: 'Sensitive'
    };

    return sensitivityMapping[sensitivity];
  }),

  /**
   * Displays email recipients for each selected config group. It also updates the list
   * if new recipients are added and successfully saved.
   * @method selectedConfigGroupRecipients
   * @return {String} comma-separated email addresses
   */
  selectedConfigGroupRecipients: Ember.computed(
    'selectedConfigGroup',
    'updatedRecipients',
    function() {
      const newRecipients = this.get('updatedRecipients');
      const originalRecipients = this.get('selectedConfigGroup.recipients');
      return Ember.isPresent(newRecipients) ? newRecipients : originalRecipients;
    }
  ),

  /**
   * Returns list of all applications for dropdown
   * @method selectedApplication
   * @return {Array} Array of application names
   */
  selectedApplication: Ember.computed(
    'selectedConfigGroup',
    'allApplications',
    function() {
      const appString = this.get('selectedConfigGroup.application');
      const allApps = this.get('allApplications');
      return _.find(allApps, function(appsObj) { return appsObj.application === appString; });
    }
  ),

  /**
   * If user chooses to assign the current alert to a new config group, we will need to post
   * these basic properties for a new record to be created. On Submit, we add the current alert
   * Id to emailConfig.functionIds and make sure none are duplicates.
   * @method newConfigGroupObj
   * @return {Object} primer props for a new alert config group
   */
  newConfigGroupObj: Ember.computed(
    'newConfigGroupName',
    function() {
      return {
        active: true,
        name: this.get('newConfigGroupName'),
        fromAddress: 'thirdeye-dev@linkedin.com',
        emailConfig: {
          functionIds: []
        }
      };
    }
  ),

  /**
   * If config group has no recipients and user has not supplied any, we want to call that out.
   * @method isEmptyEmail
   * @return {Boolean} are both values empty
   */
  isEmptyEmail: Ember.computed(
    'selectedConfigGroupRecipients',
    'alertGroupNewRecipient',
    function() {
      return Ember.isEmpty(this.get('selectedConfigGroupRecipients')) && Ember.isEmpty(this.get('alertGroupNewRecipient'));
    }
  ),

  /**
   * Disable submit under these circumstances
   * @method isSubmitDisabled
   * @return {Boolean} show/hide submit
   */
  isSubmitDisabled: Ember.computed(
    'isEmptyEmail',
    'isEmailError',
    'isDuplicateEmail',
    'isProcessingForm',
    function() {
      return this.get('isEmptyEmail') || this.get('isProcessingForm') || this.get('isEmailError' || this.get('isDuplicateEmail'));
    }
  ),

  /**
   * Fetches an alert function record by name.
   * Use case: when user names an alert, make sure no duplicate already exists.
   * @method fetchAlertByName
   * @param {String} functionName - name of alert or function
   * @return {Promise}
   */
  fetchAlertByName(functionName) {
    const url = `/data/autocomplete/functionByName?name=${functionName}`;
    return fetch(url).then(checkStatus);
  },

  /**
   * Fetches an alert function record by Id.
   * Use case: show me the names of all functions monitored by a given alert group.
   * @method fetchFunctionById
   * @param {Number} functionId - Id for the selected alert function
   * @return {Promise}
   */
  fetchFunctionById(functionId) {
    const url = `/onboard/function/${functionId}`;
    return fetch(url).then(checkStatus);
  },

  /**
   * Enriches the list of functions by Id, adding the properties we may want to display.
   * We are preparing to display the alerts that belong to the currently selected config group.
   * @method prepareFunctions
   * @param {Object} configGroup - the currently selected alert config group
   * @param {Object} newId - conditional param to help us tag any function that was "just added"
   * @return {Ember.RSVP.Promise} A new list of functions (alerts)
   */
  prepareFunctions(configGroup, newId = 0) {
    const newFunctionList = [];
    const existingFunctionList = configGroup.emailConfig ? configGroup.emailConfig.functionIds : [];
    let cnt = 0;

    // Build object for each function(alert) to display in results table
    return new Ember.RSVP.Promise((resolve) => {
      for (var functionId of existingFunctionList) {
        this.fetchFunctionById(functionId).then(functionData => {
          newFunctionList.push({
            number: cnt + 1,
            id: functionData.id,
            name: functionData.functionName,
            metric: functionData.metric + '::' + functionData.collection,
            type: functionData.type,
            active: functionData.isActive,
            isNewId: functionData.id === newId
          });
          cnt ++;
          if (existingFunctionList.length === cnt) {
            if (newId) {
              newFunctionList.reverse();
            }
            resolve(newFunctionList);
          }
        });
      }
    });
  },

  /**
   * Double-check new email array for errors.
   * @method isEmailValid
   * @param {Array} emailArr - array of new emails entered by user
   * @return {Boolean} whether errors were found
   */
  isEmailValid(emailArr) {
    const emailRegex = /^.{3,}\@linkedin.com$/;
    let isValid = true;
    for (var email of emailArr) {
      isValid = emailRegex.test(email);
    }
    return isValid;
  },

  /**
   * Display success banners while model reloads
   * @method confirmEditSuccess
   * @return {undefined}
   */
  confirmEditSuccess() {
    const that = this;
    this.setProperties({
      isEditAlertSuccess: true,
      isProcessingForm: false
    });
    Ember.run.later((function() {
      that.clearAll();
      that.send('refreshModel');
    }), 3000);
  },

  /**
   * Reset fields to model init state
   * @method clearAll
   * @return {undefined}
   */
  clearAll() {
    this.setProperties({
      isSubmitDisabled: false,
      isEmailError: false,
      isDuplicateEmail: false,
      isEditedConfigGroup: false,
      isNewConfigGroup: false,
      alertGroupNewRecipient: null,
      newConfigGroupName: null,
      isEditAlertError: false,
      isEditAlertSuccess: false,
      isNewConfigGroupSaved: false,
      isProcessingForm: false,
      updatedRecipients: [],
    });
  },

  /**
   * Actions for edit alert form view
   */
  actions: {
    /**
     * Make sure alert name does not already exist in the system
     * @method validateAlertName
     * @param {String} name - The new alert name
     * @return {undefined}
     */
    validateAlertName(name) {
      const originalName = this.get('model.function.functionName');
      let isDuplicateName = false;
      if (name === originalName) { return; }

      this.fetchAlertByName(name).then(alert => {
        for (var resultObj of alert) {
          if (resultObj.functionName === name) {
            isDuplicateName = true;
          }
        }
        this.set('isAlertNameDuplicate', isDuplicateName);
      });
    },

    /**
     * Verify that email address does not already exist in alert group. If it does, remove it and alert user.
     * @method validateAlertEmail
     * @param {String} emailInput - Comma-separated list of new emails to add to the config group.
     * @return {undefined}
     */
    validateAlertEmail(emailInput) {
      const newEmailArr = emailInput.replace(/\s+/g, '').split(',');
      let existingEmailArr = this.get('selectedConfigGroupRecipients');
      let cleanEmailArr = [];
      let badEmailArr = [];
      let isDuplicateEmail = false;

      // Release submit button error state
      this.setProperties({
        isEmailError: false,
        isEmptyEmail: false,
        isProcessingForm: false,
        isEditedConfigGroup: true
      });

      // Check for duplicates
      if (emailInput.trim() && existingEmailArr) {
        existingEmailArr = existingEmailArr.replace(/\s+/g, '').split(',');
        for (var email of newEmailArr) {
          if (existingEmailArr.includes(email)) {
            isDuplicateEmail = true;
            badEmailArr.push(email);
          } else {
            cleanEmailArr.push(email);
          }
        }
        this.setProperties({
          isDuplicateEmail,
          duplicateEmails: badEmailArr.join()
        });
      }
    },

    /**
     * Reset selected group list if user chooses to create a new group
     * @method validateNewGroupName
     * @param {String} name - User-provided alert group name
     * @return {undefined}
     */
    validateNewGroupName(name) {
      let nameIsDupe = false;

      if (name && name.trim().length) {
        nameIsDupe = this.get('allAlertsConfigGroups')
          .map(group => group.name)
          .includes(name);

        this.setProperties({
          isGroupNameDuplicate: nameIsDupe,
          selectedConfigGroup: null,
          isEditedConfigGroup: true,
          isNewConfigGroup: true,
          selectedConfigGroupRecipients: null
        });
      }
    },

    /**
     * Set our selected alert configuration group. If one is selected, display editable fields
     * for that group and display the list of functions that belong to that group.
     * @method onSelectConfigGroup
     * @param {Object} selectedObj - The selected config group option
     * @return {undefined}
     */
    onSelectConfigGroup(selectedObj) {
      const emails = selectedObj.recipients || '';
      const configGroupSwitched = selectedObj.name !== this.get('model.originalConfigGroup.name');

      this.setProperties({
        selectedConfigGroup: selectedObj,
        selectedConfigGroupName: selectedObj.name,
        newConfigGroupName: null,
        isEditedConfigGroup: true,
        isNewConfigGroup: configGroupSwitched,
        selectedConfigGroupRecipients: emails.split(',').filter(e => String(e).trim()).join(', ')
      });

      this.prepareFunctions(selectedObj).then(functionData => {
        this.set('selectedGroupFunctions', functionData);
      });
    },

    /**
     * Action handler for app name selection
     * @returns {undefined}
     */
    onSelectAppName(selectedObj) {
      this.setProperties({
        isEditedConfigGroup: true,
        selectedApplication: selectedObj
      });
    },

    /**
     * Action handler for CANCEL button - simply reset all fields
     * @returns {undefined}
     */
    onCancel() {
      this.clearAll();
      this.transitionToRoute('manage.alerts');
    },

    /**
     * Action handler for form submit
     * MVP Version: Can activate/deactivate and update alert name and edit config group data
     * @returns {Promise}
     */
    onSubmit() {
      const currentId = this.get('alertId');
      const postFunctionBody = this.get('model.function');
      const newGroupName = this.get('newConfigGroupName');
      const newEmails = this.get('alertGroupNewRecipient');
      const oldEmails = this.get('selectedConfigGroupRecipients');
      const configUrl = `/thirdeye/entity?entityType=ALERT_CONFIG`;
      const alertUrl = `/thirdeye/entity?entityType=ANOMALY_FUNCTION`;
      const originalConfigGroup = this.get('model.originalConfigGroup');
      const newApplication = this.get('selectedApplication.application');
      const newEmailsArr = newEmails ? newEmails.replace(/ /g,'').split(',') : [];
      const existingEmailsArr = oldEmails ? oldEmails.replace(/ /g,'').split(',') : [];
      const newRecipientsArr = newEmailsArr.length ? existingEmailsArr.concat(newEmailsArr) : existingEmailsArr;
      const cleanRecipientsArr = newRecipientsArr.filter(e => String(e).trim()).join(',');
      const postConfigBody = newGroupName ? this.get('newConfigGroupObj') : this.get('selectedConfigGroup');
      const groupAlertIdArray = postConfigBody.emailConfig ? postConfigBody.emailConfig.functionIds.concat([currentId]) : [];
      const dedupedGroupAlertIdArray = groupAlertIdArray.length ? Array.from(new Set(groupAlertIdArray)) : [currentId];
      const emailError = !this.isEmailValid(newEmailsArr);
      let postProps = {};

      // Disable submit for now and make sure we're clear of email errors
      this.setProperties({
        isProcessingForm: true,
        isEmailError: !this.isEmailValid(newEmailsArr)
      });

      // Exit quietly (showing warning) in the event of error
      if (emailError) { return; }

      // Assign these fresh editable values to the Alert object currently being edited
      Ember.set(postFunctionBody, 'functionName', this.get('alertFunctionName'));
      Ember.set(postFunctionBody, 'isActive', this.get('isActive'));

      // Prepare the POST payload to save an edited Alert object
      postProps = {
        method: 'post',
        body: JSON.stringify(postFunctionBody),
        headers: { 'content-type': 'Application/Json' }
      };

      // Step 1: Save any edits to the Alert entity in our DB
      return fetch(alertUrl, postProps).then((res) => checkStatus(res, 'post'))
      .then((saveAlertResponse) => {

        // Step 2: If any edits were made to the Notification Group, prep a POST object to save Config entity
        if (this.get('isEditedConfigGroup')) {

          // Whether its a new Config object or existing, assign new user-supplied values to these props:
          Ember.set(postConfigBody, 'application', newApplication);
          Ember.set(postConfigBody, 'recipients', cleanRecipientsArr);

          // Make sure current Id is part of new config array
          if (postConfigBody.emailConfig) {
            postConfigBody.emailConfig.functionIds = dedupedGroupAlertIdArray;
          } else {
            postConfigBody.emailConfig = { functionIds: dedupedGroupAlertIdArray };
          }

          // Re-use the postProps object, now for config group data
          postProps.body = JSON.stringify(postConfigBody);

          // Save the edited or new config object (we've added the new Alert Id to it)
          return fetch(configUrl, postProps).then((res) => checkStatus(res, 'post'))
          .then((saveConfigResponseA) => {
            this.setProperties({
              selectedConfigGroupRecipients: cleanRecipientsArr,
              alertGroupNewRecipient: null,
              newConfigGroupName: null
            });

            // If the user switched config groups or created a new one, remove Alert Id from previous group
            if (this.get('isNewConfigGroup')) {
              _.pull(originalConfigGroup.emailConfig.functionIds, currentId);
              postProps.body = JSON.stringify(originalConfigGroup);
              return fetch(configUrl, postProps).then((res) => checkStatus(res, 'post'))
              .then((saveConfigResponseB) => {

                // If save successful, update new config group name before model refresh (avoid big data delay)
                this.set('updatedRecipients', cleanRecipientsArr);
                if (Ember.isPresent(newGroupName)) {
                  this.setProperties({
                    isNewConfigGroupSaved: true,
                    selectedConfigGroup: this.get('newConfigGroupObj')
                  });
                }
                this.confirmEditSuccess();
                return;
              });
            } else {
              this.confirmEditSuccess();
            }
          });
        } else {
          this.confirmEditSuccess();
        }
      })
      .catch((error) => {
        this.set('isEditAlertError', true);
      });
    }
  }
});